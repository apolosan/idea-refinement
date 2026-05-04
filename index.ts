import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
	applyIdeaRefinementProgressEvent,
	buildIdeaRefinementStatusLine,
	buildIdeaRefinementWidgetLines,
	createIdeaRefinementMonitorState,
	setIdeaRefinementMonitorDetail,
	stageDisplayName,
} from "./lib/ui-monitor.ts";
import { runIdeaRefinementWorkflow } from "./lib/workflow.ts";
import { parsePositiveInteger } from "./lib/validation.ts";
import { runResponseValidatorCheck } from "./lib/validator-check.ts";

const STATUS_KEY = "idea-refinement";
const WIDGET_KEY = "idea-refinement-monitor";
const RENDER_DEBOUNCE_MS = 150;

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

export default function ideaRefinementExtension(pi: ExtensionAPI) {
	let runInProgress = false;

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
			let renderTimer: ReturnType<typeof setTimeout> | undefined;
			let lastConsoleEventMessage: string | undefined;
			let lastWorkingMessage: string | undefined;

			const setWorking = (message: string | undefined) => {
				const limited = message && message.length > 80 ? `${message.slice(0, 77)}...` : message;
				if (limited !== lastWorkingMessage) {
					lastWorkingMessage = limited;
					ctx.ui.setWorkingMessage?.(limited);
				}
			};

			const renderMonitor = () => {
				const statusLine = buildIdeaRefinementStatusLine(monitorState);
				ctx.ui.setStatus(STATUS_KEY, statusLine);
				// P1-3: Distinct channels.
				// setStatus = state summary (loop, stage, score) — already built into statusLine.
				// setWorkingMessage = current action detail — managed by the active spinner.
				ctx.ui.setWidget(WIDGET_KEY, buildIdeaRefinementWidgetLines(monitorState));
			};

			let lastRenderTime = 0;
			const RENDER_THROTTLE_MS = 1000;

			const scheduleRender = (immediate = false) => {
				if (immediate) {
					if (renderTimer) {
						clearTimeout(renderTimer);
						renderTimer = undefined;
					}
					renderMonitor();
					lastRenderTime = Date.now();
					return;
				}

				if (renderTimer) return;
				const now = Date.now();
				const elapsed = now - lastRenderTime;
				if (elapsed >= RENDER_THROTTLE_MS) {
					renderMonitor();
					lastRenderTime = now;
					return;
				}
				renderTimer = setTimeout(() => {
					renderTimer = undefined;
					renderMonitor();
					lastRenderTime = Date.now();
				}, RENDER_DEBOUNCE_MS);
			};

			const updateUiStatus = (message: string | undefined) => {
				setIdeaRefinementMonitorDetail(monitorState, message);
				setWorking(message);
				scheduleRender(true);
			};

			const handleProgressEvent = (event: Parameters<typeof applyIdeaRefinementProgressEvent>[1]) => {
				applyIdeaRefinementProgressEvent(monitorState, event);
				if (shouldNotifyProgressEvent(event) && event.message !== lastConsoleEventMessage) {
					lastConsoleEventMessage = event.message;
					ctx.ui.notify(event.message, progressEventLevel(event));
				}
				scheduleRender(true);
			};

			runInProgress = true;
			// Clear dedup cache when starting a new run
			lastWorkingMessage = undefined;
			ctx.ui.setWorkingVisible?.(true);
			ctx.ui.setWorkingIndicator?.({ frames: ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"], intervalMs: 160 });
			ctx.ui.notify(`Starting /idea-refine with ${loops} loop(s). Progress will be shown in the console and monitor.`, "info");
			setWorking("Initializing workflow monitor...");

			try {
				const result = await runIdeaRefinementWorkflow({
					cwd: ctx.cwd,
					idea,
					loops,
					modelPattern: getCurrentModelPattern(ctx),
					onStatus: updateUiStatus,
					onEvent: handleProgressEvent,
				});

				// P1 #6: Validates RESPONSE.md with epistemic validator (async, non-critical)
				const responsePath = path.join(result.callDir, "RESPONSE.md");
				// C4 fix: Log errors instead of silently swallowing
				runResponseValidatorCheck(responsePath).catch((err) => {
					console.error("[idea-refinement] Validator check failed:", err);
				});

				scheduleRender(true);
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
				scheduleRender(true);
				ctx.ui.notify(`Idea refinement workflow failed: ${message}`, "error");
			} finally {
				runInProgress = false;
				if (renderTimer) {
					clearTimeout(renderTimer);
					renderTimer = undefined;
				}
				ctx.ui.setWorkingIndicator?.();
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.setWorkingMessage?.(undefined);
				ctx.ui.setWorkingVisible?.(false);
			}
		},
	});
}
