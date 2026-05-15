import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	applyIdeaRefinementProgressEvent,
	buildIdeaRefinementStatusLine,
	buildIdeaRefinementWidgetLines,
	createIdeaRefinementMonitorState,
	setIdeaRefinementMonitorDetail,
} from "./lib/ui-monitor.ts";
import { posixJobControlSupported } from "./lib/platform-support.ts";
import { WorkflowRuntimeControl } from "./lib/workflow-runtime-control.ts";
import { analyzeFailedRunForResume, runIdeaRefinementResumeWorkflow, runIdeaRefinementWorkflow } from "./lib/workflow.ts";
import { parsePositiveInteger } from "./lib/validation.ts";
import { runResponseValidatorCheck } from "./lib/validator-check.ts";
import { LOOP_COUNT_HARD_LIMIT, LOOP_COUNT_SOFT_CONFIRM_THRESHOLD } from "./lib/workflow-limits.ts";

const STATUS_KEY = "idea-refinement";
const WIDGET_KEY = "idea-refinement-monitor";
const HEARTBEAT_MS = 300;
const STATUS_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PAUSE_SHORTCUT = "ctrl+alt+p";
const STOP_SHORTCUT = "ctrl+alt+x";
const FIXED_STAGE_COUNT = 3;
const STAGES_PER_LOOP = 2;
const ESTIMATED_MINUTES_PER_LOOP_MIN = 3;
const ESTIMATED_MINUTES_PER_LOOP_MAX = 6;

export interface IdeaRefinementExtensionDeps {
	analyzeFailedRunForResume: typeof analyzeFailedRunForResume;
	runIdeaRefinementResumeWorkflow: typeof runIdeaRefinementResumeWorkflow;
	runIdeaRefinementWorkflow: typeof runIdeaRefinementWorkflow;
	runResponseValidatorCheck: typeof runResponseValidatorCheck;
}

const defaultIdeaRefinementExtensionDeps: IdeaRefinementExtensionDeps = {
	analyzeFailedRunForResume,
	runIdeaRefinementResumeWorkflow,
	runIdeaRefinementWorkflow,
	runResponseValidatorCheck,
};

function shouldNotifyProgressEvent(event: Parameters<typeof applyIdeaRefinementProgressEvent>[1]): boolean {
	switch (event.type) {
		case "workflow_started":
		case "stage_started":
		case "stage_completed":
		case "stage_failed":
		case "loop_completed":
		case "workflow_completed":
		case "workflow_failed":
			return true;
		default:
			return false;
	}
}

function progressEventLevel(event: Parameters<typeof applyIdeaRefinementProgressEvent>[1]): "info" | "warning" | "error" {
	if (event.type === "stage_failed" || event.type === "workflow_failed" || event.isError) return "error";
	return "info";
}

async function collectIdea(args: string, ctx: ExtensionCommandContext): Promise<string | undefined> {
	const inlineIdea = args.trim();
	if (inlineIdea.length > 0) {
		return inlineIdea;
	}

	const editorResult = await ctx.ui.editor("Describe the idea to be refined", "");
	const idea = editorResult?.trim();
	return idea && idea.length > 0 ? idea : undefined;
}

function describeLoopExecutionEstimate(loops: number): { stageCount: number; minMinutes: number; maxMinutes: number } {
	const stageCount = FIXED_STAGE_COUNT + (loops * STAGES_PER_LOOP);
	return {
		stageCount,
		minMinutes: loops * ESTIMATED_MINUTES_PER_LOOP_MIN,
		maxMinutes: loops * ESTIMATED_MINUTES_PER_LOOP_MAX,
	};
}

async function confirmLoopCountIfNeeded(ctx: ExtensionCommandContext, loops: number): Promise<boolean> {
	if (loops > LOOP_COUNT_HARD_LIMIT) {
		ctx.ui.notify(`Loop count ${loops} exceeds the hard limit of ${LOOP_COUNT_HARD_LIMIT}. Choose a smaller value.`, "warning");
		return false;
	}
	if (loops <= LOOP_COUNT_SOFT_CONFIRM_THRESHOLD) return true;

	const estimate = describeLoopExecutionEstimate(loops);
	const message = [
		`This run schedules approximately ${estimate.stageCount} subprocess stages.`,
		`Expected runtime: roughly ${estimate.minMinutes}-${estimate.maxMinutes} minutes, depending on model/tool activity.`,
		"Token/cost usage also scales with the number of loops.",
		"Do you want to continue with this large loop count?",
	].join("\n");

	if (typeof ctx.ui.confirm === "function") {
		const confirmed = await ctx.ui.confirm("Large loop count confirmation", message);
		if (!confirmed) {
			ctx.ui.notify("Loop count was not confirmed. Choose a smaller value or confirm the large run.", "info");
		}
		return confirmed;
	}

	const fallback = await ctx.ui.input("Type YES to confirm the large loop count", `YES to continue with ${loops} loops`);
	const confirmed = fallback?.trim().toUpperCase() === "YES";
	if (!confirmed) {
		ctx.ui.notify("Loop count was not confirmed. Choose a smaller value or confirm the large run.", "info");
	}
	return confirmed;
}

async function collectLoopCount(ctx: ExtensionCommandContext, title = "How many development loops do you want to run?", placeholder = "Enter a positive integer"): Promise<number | undefined> {
	ctx.ui.notify(
		"Extension suggestion: 5 to 20 loops usually balances depth with cost and runtime. You may choose another value.",
		"info",
	);
	while (true) {
		const input = await ctx.ui.input(title, placeholder);
		if (input === undefined) return undefined;

		const parsed = parsePositiveInteger(input);
		if (parsed === undefined) {
			ctx.ui.notify("Invalid value. Enter a positive integer.", "warning");
			continue;
		}

		if (await confirmLoopCountIfNeeded(ctx, parsed)) return parsed;
	}
}

async function collectResumeSourceSpecifier(args: string, ctx: ExtensionCommandContext): Promise<string | undefined> {
	const inline = args.trim();
	if (inline.length > 0) return inline;
	const input = await ctx.ui.input("Failed run path or execution index (NN)", "Example: 4 or docs/idea_refinement/artifacts_call_04");
	const trimmed = input?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

async function collectResumeFinalLoopCount(ctx: ExtensionCommandContext, lastConsistentLoop: number, suggestedFinalLoop: number): Promise<number | undefined> {
	while (true) {
		const input = await ctx.ui.input(
			"Final loop target for resumed execution",
			`Enter a positive integer >= ${lastConsistentLoop || 1} (suggested: ${suggestedFinalLoop})`,
		);
		if (input === undefined) return undefined;
		const parsed = parsePositiveInteger(input);
		if (parsed === undefined || parsed < lastConsistentLoop) {
			ctx.ui.notify(`Invalid value. Enter a positive integer >= ${lastConsistentLoop}.`, "warning");
			continue;
		}
		if (await confirmLoopCountIfNeeded(ctx, parsed)) return parsed;
	}
}

function formatResumeAnalysisSummary(analysis: Awaited<ReturnType<typeof analyzeFailedRunForResume>>): string {
	return [
		`- Source run: ${analysis.sourceRelativeCallDir}`,
		`- Failure category: ${analysis.failureCategory}`,
		`- Failure reason: ${analysis.failureReason ?? "not recorded"}`,
		`- Last consistent loop: ${analysis.lastConsistentLoop}`,
		`- Recommended start loop: ${analysis.recommendedStartLoop}`,
		`- Can skip bootstrap: ${analysis.canSkipBootstrap ? "yes" : "no"}`,
		`- Missing artifacts: ${analysis.missingArtifacts.length > 0 ? analysis.missingArtifacts.join(", ") : "none"}`,
	].join("\n");
}

async function collectResumeInstructions(ctx: ExtensionCommandContext, analysisSummary: string): Promise<string | undefined> {
	const template = [
		"# Resume workaround instructions",
		"",
		analysisSummary,
		"",
		"## Instructions",
		"- Describe any workaround instructions, constraints, exclusions, or special handling for the resumed run.",
		"- Keep the resumed execution anchored to the last consistent loop unless there is explicit new evidence.",
		"",
	].join("\n");
	const result = await ctx.ui.editor("Resume workaround instructions", template);
	const trimmed = result?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function getCurrentModelPattern(ctx: ExtensionCommandContext): string | undefined {
	if (!ctx.model) return undefined;
	return `${ctx.model.provider}/${ctx.model.id}`;
}

function getCurrentThinkingLevel(pi: ExtensionAPI): string | undefined {
	try {
		const thinkingLevel = pi.getThinkingLevel?.();
		return typeof thinkingLevel === "string" && thinkingLevel.length > 0 ? thinkingLevel : undefined;
	} catch {
		return undefined;
	}
}

function buildPauseResumeHelp(isPaused: boolean): string {
	return isPaused
		? `Paused • ${PAUSE_SHORTCUT} resume • ${STOP_SHORTCUT} stop`
		: `${PAUSE_SHORTCUT} pause • ${STOP_SHORTCUT} stop`;
}

function handlePauseShortcut(runtimeControl: WorkflowRuntimeControl, runInProgress: boolean, ctx: ExtensionContext): void {
	if (!runInProgress) {
		ctx.ui.notify("No idea-refinement workflow is currently running.", "warning");
		return;
	}
	const result = runtimeControl.togglePause();
	if (result.paused && !posixJobControlSupported()) {
		ctx.ui.notify(
			"Pause requested, but SIGSTOP/SIGCONT are not available on this platform. The subprocess may keep running until the stage completes.",
			"warning",
		);
	}
	ctx.ui.notify(result.message, result.paused ? "warning" : "info");
}

function handleStopShortcut(runtimeControl: WorkflowRuntimeControl, runInProgress: boolean, ctx: ExtensionContext): void {
	if (!runInProgress) {
		ctx.ui.notify("No idea-refinement workflow is currently running.", "warning");
		return;
	}
	const result = runtimeControl.requestStop("Workflow interrupted by user.");
	ctx.ui.notify(result.message, "warning");
}

export function createIdeaRefinementExtension(deps: IdeaRefinementExtensionDeps = defaultIdeaRefinementExtensionDeps) {
return function ideaRefinementExtension(pi: ExtensionAPI) {
	let runInProgress = false;
	const runtimeControl = new WorkflowRuntimeControl();

	pi.registerShortcut(PAUSE_SHORTCUT, {
		description: "Pause or resume the active idea-refinement workflow",
		handler: async (ctx) => {
			handlePauseShortcut(runtimeControl, runInProgress, ctx);
		},
	});

	pi.registerShortcut(STOP_SHORTCUT, {
		description: "Stop the active idea-refinement workflow",
		handler: async (ctx) => {
			handleStopShortcut(runtimeControl, runInProgress, ctx);
		},
	});

	pi.registerCommand("idea-refine-pause", {
		description: "Pause or resume the active idea-refinement workflow",
		handler: async (_args, ctx) => {
			handlePauseShortcut(runtimeControl, runInProgress, ctx);
		},
	});

	pi.registerCommand("idea-refine-stop", {
		description: "Stop the active idea-refinement workflow",
		handler: async (_args, ctx) => {
			handleStopShortcut(runtimeControl, runInProgress, ctx);
		},
	});

	pi.registerCommand("idea-refine", {
		description: "Runs the forced iterative idea-refinement workflow",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/idea-refine requires interactive mode.", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("Select a model before running /idea-refine.", "error");
				return;
			}

			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current agent to finish before starting /idea-refine.", "warning");
				return;
			}

			if (runInProgress) {
				ctx.ui.notify("An idea-refinement run is already in progress.", "warning");
				return;
			}

			runInProgress = true;

			let idea: string | undefined;
			try {
				idea = await collectIdea(args, ctx);
			} catch (error) {
				runInProgress = false;
				throw error;
			}
			if (!idea) {
				runInProgress = false;
				ctx.ui.notify("Run canceled: no idea was provided.", "info");
				return;
			}

			let loops: number | undefined;
			try {
				loops = await collectLoopCount(ctx);
			} catch (error) {
				runInProgress = false;
				throw error;
			}
			if (loops === undefined) {
				runInProgress = false;
				ctx.ui.notify("Run canceled before loop count was defined.", "info");
				return;
			}

			const monitorState = createIdeaRefinementMonitorState();
			let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
			let lastConsoleEventMessage: string | undefined;
			let lastWorkingMessage: string | undefined;
			let spinnerIndex = 0;

			const setWorking = (message: string | undefined) => {
				const limited = message && message.length > 120 ? `${message.slice(0, 117)}...` : message;
				if (limited !== lastWorkingMessage) {
					lastWorkingMessage = limited;
					ctx.ui.setWorkingMessage?.(limited);
				}
			};

			const renderMonitor = () => {
				monitorState.elapsedMs = runtimeControl.getElapsedMs();
				monitorState.isPaused = runtimeControl.isPaused();
				monitorState.spinnerFrame = runtimeControl.isPaused() ? "⏸" : STATUS_SPINNER_FRAMES[spinnerIndex % STATUS_SPINNER_FRAMES.length];
				const statusLine = buildIdeaRefinementStatusLine(monitorState);
				ctx.ui.setStatus(STATUS_KEY, statusLine);
				ctx.ui.setWidget(WIDGET_KEY, buildIdeaRefinementWidgetLines(monitorState));
			};

			const updateUiStatus = (message: string | undefined) => {
				setIdeaRefinementMonitorDetail(monitorState, message);
				const suffix = buildPauseResumeHelp(runtimeControl.isPaused());
				setWorking(message ? `${message} • ${suffix}` : suffix);
				renderMonitor();
			};

			const handleProgressEvent = (event: Parameters<typeof applyIdeaRefinementProgressEvent>[1]) => {
				applyIdeaRefinementProgressEvent(monitorState, event);
				if (shouldNotifyProgressEvent(event) && event.message !== lastConsoleEventMessage) {
					lastConsoleEventMessage = event.message;
					ctx.ui.notify(event.message, progressEventLevel(event));
				}
				renderMonitor();
			};

			runtimeControl.startRun();
			lastWorkingMessage = undefined;
			ctx.ui.setWorkingVisible?.(true);
			ctx.ui.setWorkingMessage?.(`Initializing workflow monitor... • ${buildPauseResumeHelp(false)}`);
			ctx.ui.notify(
				`Starting /idea-refine with ${loops} loop(s). Shortcuts: ${PAUSE_SHORTCUT} pause/resume, ${STOP_SHORTCUT} stop.`,
				"info",
			);
			renderMonitor();

			heartbeatTimer = setInterval(() => {
				spinnerIndex = (spinnerIndex + 1) % STATUS_SPINNER_FRAMES.length;
				renderMonitor();
				if (runtimeControl.isPaused()) {
					setWorking(buildPauseResumeHelp(true));
				}
			}, HEARTBEAT_MS);

			try {
				const result = await deps.runIdeaRefinementWorkflow({
					cwd: ctx.cwd,
					idea,
					loops,
					modelPattern: getCurrentModelPattern(ctx),
					thinkingLevel: getCurrentThinkingLevel(pi),
					onStatus: updateUiStatus,
					onEvent: handleProgressEvent,
					runtimeControl,
				});

				const responsePath = path.join(result.callDir, "RESPONSE.md");
				const manifestPath = path.join(result.callDir, "run.json");
				deps.runResponseValidatorCheck(responsePath, { manifestPath, cwd: ctx.cwd }).catch((err) => {
					console.error("[idea-refinement] Validator check failed:", err);
				});

				renderMonitor();
				const lastScoreSuffix = typeof result.latestScore === "number" ? ` • final score ${result.latestScore}/100` : "";
				ctx.ui.notify(`Idea refinement completed: ${result.relativeCallDir}${lastScoreSuffix}`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (monitorState.workflowStatus !== "failed") {
					handleProgressEvent({
						type: "workflow_failed",
						relativeCallDir: monitorState.relativeCallDir ?? "",
						requestedLoops: loops,
						completedLoops: monitorState.completedLoops,
						message: `Workflow failed: ${message}`,
						isError: true,
					});
				}
				renderMonitor();
				ctx.ui.notify(`Idea refinement workflow failed: ${message}`, "error");
			} finally {
				runInProgress = false;
				if (heartbeatTimer) {
					clearInterval(heartbeatTimer);
					heartbeatTimer = undefined;
				}
				runtimeControl.finishRun();
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				ctx.ui.setWorkingMessage?.(undefined);
				ctx.ui.setWorkingVisible?.(false);
			}
		},
	});

	pi.registerCommand("idea-refine-resume", {
		description: "Resume a failed idea-refinement run from the last consistent loop using a failed call path or execution index (NN)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/idea-refine-resume requires interactive mode.", "error");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("Select a model before running /idea-refine-resume.", "error");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current agent to finish before starting /idea-refine-resume.", "warning");
				return;
			}
			if (runInProgress) {
				ctx.ui.notify("An idea-refinement run is already in progress.", "warning");
				return;
			}

			runInProgress = true;

			const sourceCallSpecifier = await collectResumeSourceSpecifier(args, ctx);
			if (!sourceCallSpecifier) {
				runInProgress = false;
				ctx.ui.notify("Resume canceled: no failed run path or execution index was provided.", "info");
				return;
			}

			let analysis;
			try {
				analysis = await deps.analyzeFailedRunForResume(ctx.cwd, sourceCallSpecifier);
			} catch (error) {
				runInProgress = false;
				ctx.ui.notify(`Resume analysis failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			const analysisSummary = formatResumeAnalysisSummary(analysis);
			ctx.ui.notify(`Resume analysis ready: ${analysis.sourceRelativeCallDir} • last consistent loop ${analysis.lastConsistentLoop} • ${analysis.failureCategory}`, "info");

			const finalLoopCount = await collectResumeFinalLoopCount(
				ctx,
				analysis.lastConsistentLoop,
				Math.max(analysis.sourceManifest.requestedLoops, analysis.lastConsistentLoop),
			);
			if (finalLoopCount === undefined) {
				runInProgress = false;
				ctx.ui.notify("Resume canceled before the final loop target was defined.", "info");
				return;
			}

			const workaroundInstructions = await collectResumeInstructions(ctx, analysisSummary);
			if (!workaroundInstructions) {
				runInProgress = false;
				ctx.ui.notify("Resume canceled: workaround instructions were not provided.", "info");
				return;
			}

			const monitorState = createIdeaRefinementMonitorState();
			let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
			let lastConsoleEventMessage: string | undefined;
			let lastWorkingMessage: string | undefined;
			let spinnerIndex = 0;

			const setWorking = (message: string | undefined) => {
				const limited = message && message.length > 120 ? `${message.slice(0, 117)}...` : message;
				if (limited !== lastWorkingMessage) {
					lastWorkingMessage = limited;
					ctx.ui.setWorkingMessage?.(limited);
				}
			};

			const renderMonitor = () => {
				monitorState.elapsedMs = runtimeControl.getElapsedMs();
				monitorState.isPaused = runtimeControl.isPaused();
				monitorState.spinnerFrame = runtimeControl.isPaused() ? "⏸" : STATUS_SPINNER_FRAMES[spinnerIndex % STATUS_SPINNER_FRAMES.length];
				const statusLine = buildIdeaRefinementStatusLine(monitorState);
				ctx.ui.setStatus(STATUS_KEY, statusLine);
				ctx.ui.setWidget(WIDGET_KEY, buildIdeaRefinementWidgetLines(monitorState));
			};

			const updateUiStatus = (message: string | undefined) => {
				setIdeaRefinementMonitorDetail(monitorState, message);
				const suffix = buildPauseResumeHelp(runtimeControl.isPaused());
				setWorking(message ? `${message} • ${suffix}` : suffix);
				renderMonitor();
			};

			const handleProgressEvent = (event: Parameters<typeof applyIdeaRefinementProgressEvent>[1]) => {
				applyIdeaRefinementProgressEvent(monitorState, event);
				if (shouldNotifyProgressEvent(event) && event.message !== lastConsoleEventMessage) {
					lastConsoleEventMessage = event.message;
					ctx.ui.notify(event.message, progressEventLevel(event));
				}
				renderMonitor();
			};

			runtimeControl.startRun();
			lastWorkingMessage = undefined;
			ctx.ui.setWorkingVisible?.(true);
			ctx.ui.setWorkingMessage?.(`Initializing resume workflow monitor... • ${buildPauseResumeHelp(false)}`);
			ctx.ui.notify(
				`Starting /idea-refine-resume from ${analysis.sourceRelativeCallDir} to loop ${finalLoopCount}. Shortcuts: ${PAUSE_SHORTCUT} pause/resume, ${STOP_SHORTCUT} stop.`,
				"info",
			);
			renderMonitor();

			heartbeatTimer = setInterval(() => {
				spinnerIndex = (spinnerIndex + 1) % STATUS_SPINNER_FRAMES.length;
				renderMonitor();
				if (runtimeControl.isPaused()) setWorking(buildPauseResumeHelp(true));
			}, HEARTBEAT_MS);

			try {
				const result = await deps.runIdeaRefinementResumeWorkflow({
					cwd: ctx.cwd,
					sourceCallSpecifier,
					finalLoopCount,
					workaroundInstructions,
					modelPattern: getCurrentModelPattern(ctx),
					thinkingLevel: getCurrentThinkingLevel(pi),
					onStatus: updateUiStatus,
					onEvent: handleProgressEvent,
					runtimeControl,
				});

				const responsePath = path.join(result.callDir, "RESPONSE.md");
				const manifestPath = path.join(result.callDir, "run.json");
				deps.runResponseValidatorCheck(responsePath, { manifestPath, cwd: ctx.cwd }).catch((err) => {
					console.error("[idea-refinement] Validator check failed:", err);
				});

				renderMonitor();
				const lastScoreSuffix = typeof result.latestScore === "number" ? ` • final score ${result.latestScore}/100` : "";
				ctx.ui.notify(`Idea refinement resume completed: ${result.relativeCallDir}${lastScoreSuffix}`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (monitorState.workflowStatus !== "failed") {
					handleProgressEvent({
						type: "workflow_failed",
						relativeCallDir: monitorState.relativeCallDir ?? "",
						requestedLoops: finalLoopCount,
						completedLoops: monitorState.completedLoops,
						message: `Resume workflow failed: ${message}`,
						isError: true,
					});
				}
				renderMonitor();
				ctx.ui.notify(`Idea refinement resume failed: ${message}`, "error");
			} finally {
				runInProgress = false;
				if (heartbeatTimer) {
					clearInterval(heartbeatTimer);
					heartbeatTimer = undefined;
				}
				runtimeControl.finishRun();
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				ctx.ui.setWorkingMessage?.(undefined);
				ctx.ui.setWorkingVisible?.(false);
			}
		},
	});
};
}

export default createIdeaRefinementExtension();
