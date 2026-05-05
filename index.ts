import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	applyIdeaRefinementProgressEvent,
	buildIdeaRefinementStatusLine,
	buildIdeaRefinementWidgetLines,
	createIdeaRefinementMonitorState,
	setIdeaRefinementMonitorDetail,
} from "./lib/ui-monitor.ts";
import { WorkflowRuntimeControl } from "./lib/workflow-runtime-control.ts";
import { runIdeaRefinementWorkflow } from "./lib/workflow.ts";
import { parsePositiveInteger } from "./lib/validation.ts";
import { runResponseValidatorCheck } from "./lib/validator-check.ts";

const STATUS_KEY = "idea-refinement";
const WIDGET_KEY = "idea-refinement-monitor";
const HEARTBEAT_MS = 120;
const STATUS_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PAUSE_SHORTCUT = "ctrl+alt+p";
const STOP_SHORTCUT = "ctrl+alt+x";

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

async function collectLoopCount(ctx: ExtensionCommandContext): Promise<number | undefined> {
	while (true) {
		const input = await ctx.ui.input("How many development loops do you want to run?", "Enter a positive integer");
		if (input === undefined) return undefined;

		const parsed = parsePositiveInteger(input);
		if (parsed !== undefined) return parsed;

		ctx.ui.notify("Invalid value. Enter a positive integer.", "warning");
	}
}

function getCurrentModelPattern(ctx: ExtensionCommandContext): string | undefined {
	if (!ctx.model) return undefined;
	return `${ctx.model.provider}/${ctx.model.id}`;
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

export default function ideaRefinementExtension(pi: ExtensionAPI) {
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

			const idea = await collectIdea(args, ctx);
			if (!idea) {
				ctx.ui.notify("Run canceled: no idea was provided.", "info");
				return;
			}

			const loops = await collectLoopCount(ctx);
			if (loops === undefined) {
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

			runInProgress = true;
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
				const result = await runIdeaRefinementWorkflow({
					cwd: ctx.cwd,
					idea,
					loops,
					modelPattern: getCurrentModelPattern(ctx),
					onStatus: updateUiStatus,
					onEvent: handleProgressEvent,
					runtimeControl,
				});

				const responsePath = path.join(result.callDir, "RESPONSE.md");
				runResponseValidatorCheck(responsePath).catch((err) => {
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
}
