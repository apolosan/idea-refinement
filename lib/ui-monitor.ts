import type { WorkflowProgressEventType, StageName, StageStatus, WorkflowProgressEvent, WorkflowStatus } from "./types.ts";

export interface IdeaRefinementMonitorState {
	workflowStatus: WorkflowStatus | "idle";
	relativeCallDir?: string;
	requestedLoops: number;
	completedLoops: number;
	currentLoop?: number;
	currentStage?: StageName;
	currentStageStatus?: StageStatus;
	currentDetail?: string;
	bootstrapStatus: StageStatus;
	loopStageStatuses: {
		develop: StageStatus;
		evaluate: StageStatus;
		learning: StageStatus;
		report: StageStatus;
		checklist: StageStatus;
	};
	activeTool?: string;
	latestScore?: number;
	lastError?: string;
	elapsedMs?: number;
	isPaused?: boolean;
	spinnerFrame?: string;
}

const STATUS_DETAIL_LIMIT = 120;
/**
 * M2 fix: stageDisplayName now exported from ui-monitor.ts
 * (was also defined locally in workflow.ts — removed duplicate)
 */
export function stageDisplayName(stageName: StageName): string {
	switch (stageName) {
		case "bootstrap":
			return "initial artifacts";
		case "develop":
			return "development";
		case "evaluate":
			return "evaluation";
		case "learning":
			return "learning";
		case "report":
			return "report";
		case "checklist":
			return "action checklist";
		default:
			return stageName;
	}
}

/**
 * M3 fix: buildStageStatusMessage exported for reuse in workflow.ts
 * (was duplicated in multiple contexts)
 */
export function buildStageStatusMessage(statusMessage: string, detail?: string): string {
	return detail ? `${statusMessage} • ${detail}` : statusMessage;
}

function workflowStatusLabel(status: WorkflowStatus | "idle", isPaused = false): string {
	if (isPaused) return "paused";
	switch (status) {
		case "running":
			return "running";
		case "success":
			return "completed";
		case "failed":
			return "failed";
		default:
			return "waiting";
	}
}

function formatElapsed(elapsedMs: number | undefined): string {
	const totalSeconds = Math.max(0, Math.floor((elapsedMs ?? 0) / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

/**
 * Returns true if the terminal likely supports Unicode box-drawing and symbols.
 * Checks TERM and LC_ALL/LC_CTYPE for known Unicode-capable values.
 */
export function shouldUseUnicode(): boolean {
	const term = (process.env.TERM ?? "").toLowerCase();
	const lcAll = (process.env.LC_ALL ?? process.env.LC_CTYPE ?? "").toLowerCase();

	// Known non-Unicode terminals
	if (term === "dumb" || term === "vt100" || term === "vt52") return false;

	// Known Unicode-capable terminals
	const unicodeTermPrefixes = ["xterm", "screen", "tmux", "rxvt", "alacritty", "kitty", "wezterm", "foot", "st-"];
	for (const prefix of unicodeTermPrefixes) {
		if (term.startsWith(prefix)) return true;
	}

	// Locale indicates UTF-8
	if (lcAll.includes("utf-8") || lcAll.includes("utf8")) return true;

	// Default: assume Unicode support on modern terminals
	return true;
}

function stageStatusIcon(status: StageStatus | undefined, unicode: boolean): string {
	if (unicode) {
		switch (status) {
			case "running":
				return "…";
			case "success":
				return "✓";
			case "failed":
				return "✗";
			case "carried_forward":
				return "↷";
			case "pending":
			default:
				return "○";
		}
	}
	switch (status) {
		case "running":
			return "~";
		case "success":
			return "+";
		case "failed":
			return "x";
		case "carried_forward":
			return ">";
		case "pending":
		default:
			return "-";
	}
}

function normalizeWhitespace(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string | undefined, maxLength: number): string {
	const normalized = normalizeWhitespace(value);
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildLoopProgressBar(completedLoops: number, requestedLoops: number, width = 20): string {
	if (requestedLoops <= 0) return "[....................]";
	const safeWidth = Math.max(8, width);
	const ratio = Math.max(0, Math.min(1, completedLoops / requestedLoops));
	const filled = Math.round(ratio * safeWidth);
	return `[${"#".repeat(filled)}${".".repeat(Math.max(0, safeWidth - filled))}]`;
}

function resetLoopStageStatuses(state: IdeaRefinementMonitorState): void {
	state.loopStageStatuses = {
		develop: "pending",
		evaluate: "pending",
		learning: "pending",
		report: "pending",
		checklist: "pending",
	};
}

function setStageStatus(state: IdeaRefinementMonitorState, stageName: StageName, status: StageStatus): void {
	if (stageName === "bootstrap") {
		state.bootstrapStatus = status;
		return;
	}

	state.loopStageStatuses[stageName] = status;
}

function formatStageReference(stageName: StageName | undefined, loopNumber: number | undefined, requestedLoops: number): string {
	if (!stageName) return "preparing execution";
	if (stageName === "bootstrap") return "bootstrap · initial artifacts";
	if (loopNumber !== undefined) return `loop ${loopNumber}/${requestedLoops} · ${stageDisplayName(stageName)}`;
	return stageDisplayName(stageName);
}

export function createIdeaRefinementMonitorState(): IdeaRefinementMonitorState {
	return {
		workflowStatus: "idle",
		requestedLoops: 0,
		completedLoops: 0,
		bootstrapStatus: "pending",
		loopStageStatuses: {
			develop: "pending",
			evaluate: "pending",
			learning: "pending",
			report: "pending",
			checklist: "pending",
		},
	};
}

export function setIdeaRefinementMonitorDetail(state: IdeaRefinementMonitorState, detail: string | undefined): void {
	state.currentDetail = detail;
}

type EventHandler = (state: IdeaRefinementMonitorState, event: WorkflowProgressEvent) => Partial<IdeaRefinementMonitorState> | void;

function applyStateUpdate(state: IdeaRefinementMonitorState, update: Partial<IdeaRefinementMonitorState> | void): void {
	if (!update) return;
	for (const key of Object.keys(update) as (keyof IdeaRefinementMonitorState)[]) {
		const value = update[key];
		if (key in update) {
			(state as unknown as Record<string, unknown>)[key] = value;
		}
	}
}

const eventHandlers: Record<WorkflowProgressEventType, EventHandler> = {
	workflow_started: (_state, event) => ({
		workflowStatus: "running",
		currentDetail: event.message,
	}),

	workflow_completed: (_state, _event) => ({
		workflowStatus: "success",
		// keep currentDetail from event.message via shared fields below
	}),

	workflow_failed: (_state, event) => ({
		workflowStatus: "failed",
		lastError: event.message,
		currentDetail: event.message,
		activeTool: undefined,
	}),

	stage_started: (state, event) => {
		if (event.stageName === "develop" && event.loopNumber !== undefined && state.currentLoop !== event.loopNumber) {
			resetLoopStageStatuses(state);
		}
		const stageStatus: StageStatus = event.stageStatus ?? "running";
		setStageStatus(state, event.stageName!, stageStatus);
		return {
			currentLoop: event.loopNumber,
			currentStage: event.stageName,
			currentStageStatus: stageStatus,
			workflowStatus: "running",
			activeTool: undefined,
			currentDetail: event.message,
		};
	},

	stage_progress: (_state, event) => ({
		currentStage: event.stageName,
		currentLoop: event.loopNumber,
		currentStageStatus: event.stageStatus,
		currentDetail: event.message,
	}),

	tool_start: (_state, event) => ({
		currentStage: event.stageName,
		currentLoop: event.loopNumber,
		activeTool: event.toolName,
		currentDetail: event.message,
	}),

	tool_end: (_state, event) => ({
		currentStage: event.stageName,
		currentLoop: event.loopNumber,
		currentDetail: event.message,
		activeTool: undefined,
	}),

	stage_completed: (state, event) => {
		const stageStatus: StageStatus = event.stageStatus ?? "success";
		setStageStatus(state, event.stageName!, stageStatus);
		return {
			currentStage: event.stageName,
			currentLoop: event.loopNumber,
			currentStageStatus: stageStatus,
			currentDetail: event.message,
			activeTool: undefined,
		};
	},

	stage_failed: (state, event) => {
		const stageStatus: StageStatus = event.stageStatus ?? "failed";
		setStageStatus(state, event.stageName!, stageStatus);
		return {
			currentStage: event.stageName,
			currentLoop: event.loopNumber,
			currentStageStatus: stageStatus,
			currentDetail: event.message,
			activeTool: undefined,
		};
	},

	thinking: (_state, _event) => {
		// No-op: thinking events don't change visible state
	},

	loop_completed: (_state, event) => ({
		currentLoop: event.loopNumber,
		currentDetail: event.message,
		activeTool: undefined,
	}),
};

export function applyIdeaRefinementProgressEvent(state: IdeaRefinementMonitorState, event: WorkflowProgressEvent): void {
	if (event.relativeCallDir) state.relativeCallDir = event.relativeCallDir;
	state.requestedLoops = event.requestedLoops;
	state.completedLoops = event.completedLoops;
	if (typeof event.score === "number") state.latestScore = event.score;

	const handler = eventHandlers[event.type];
	if (handler) {
		const update = handler(state, event);
		applyStateUpdate(state, update);
	}

	// Handle workflow_completed message separately since handler returns only status
	if (event.type === "workflow_completed") {
		state.currentDetail = event.message;
	}
}

export function buildIdeaRefinementStatusLine(state: IdeaRefinementMonitorState): string | undefined {
	const parts = [state.spinnerFrame ? `${state.spinnerFrame} idea-refine` : "idea-refine"];

	if (state.relativeCallDir) {
		parts.push(state.relativeCallDir.split("/").pop() ?? state.relativeCallDir);
	}

	// O10 fix: Include bootstrapStatus in status line when not pending
	if (state.bootstrapStatus !== "pending") {
		parts.push(`bootstrap ${state.bootstrapStatus}`);
	}

	if (state.currentLoop !== undefined && state.requestedLoops > 0) {
		parts.push(`loop ${state.currentLoop}/${state.requestedLoops}`);
	} else if (state.requestedLoops > 0) {
		parts.push(`${state.completedLoops}/${state.requestedLoops} loops`);
	}

	parts.push(`elapsed ${formatElapsed(state.elapsedMs)}`);
	if (state.isPaused) parts.push("paused");
	if (state.currentStage) parts.push(stageDisplayName(state.currentStage));
	if (state.activeTool) parts.push(`tool ${state.activeTool}`);
	if (typeof state.latestScore === "number") parts.push(`score ${state.latestScore}/100`);
	else parts.push("score --/100");
	if (state.currentDetail) parts.push(truncate(state.currentDetail, STATUS_DETAIL_LIMIT));

	return parts.length > 1 ? parts.join(" • ") : undefined;
}

export function buildIdeaRefinementWidgetLines(state: IdeaRefinementMonitorState): string[] {
	const requestedLoops = state.requestedLoops || 0;
	const loopBar = buildLoopProgressBar(state.completedLoops, requestedLoops, 20);
	const unicode = shouldUseUnicode();
	const scoreSuffix = typeof state.latestScore === "number" ? ` | score ${state.latestScore}/100` : " | score --/100";
	const currentLabel = state.currentLoop !== undefined ? ` (current: ${state.currentLoop})` : "";

	// Compact layout: guaranteed ≤ 10 lines to avoid "... (widget truncated)" from host
	const lines: string[] = [
		"[ IDEA REFINE MONITOR ]",
		`  status: ${workflowStatusLabel(state.workflowStatus, state.isPaused)}${scoreSuffix} | dir: ${state.relativeCallDir?.split("/").pop() ?? "preparing..."}`,
		`  elapsed: ${formatElapsed(state.elapsedMs)} | controls: Ctrl+Alt+P pause/resume | Ctrl+Alt+X stop`,
		`  loops: ${state.completedLoops}/${requestedLoops}${currentLabel} ${loopBar}`,
		`  stages: ${stageStatusIcon(state.bootstrapStatus, unicode)} bootstrap  ${stageStatusIcon(state.loopStageStatuses.develop, unicode)} develop  ${stageStatusIcon(state.loopStageStatuses.evaluate, unicode)} evaluate  ${stageStatusIcon(state.loopStageStatuses.learning, unicode)} learning  ${stageStatusIcon(state.loopStageStatuses.report, unicode)} report  ${stageStatusIcon(state.loopStageStatuses.checklist, unicode)} checklist`,
		`  current: ${formatStageReference(state.currentStage, state.currentLoop, requestedLoops)} | working... ${state.spinnerFrame ?? "-"}`,
		`  detail: ${truncate(state.currentDetail ?? state.lastError ?? "...", 120)}`,
	];

	return lines;
}
