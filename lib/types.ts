export const IDEA_REFINEMENT_DIR_NAME = "idea_refinement";
export const CALL_DIR_PREFIX = "artifacts_call_";
export const LOOP_DIR_PREFIX = "loop_";

export const ARTIFACT_FILE_NAMES = {
	idea: "IDEA.md",
	directive: "DIRECTIVE.md",
	learning: "LEARNING.md",
	criteria: "CRITERIA.md",
	diagnosis: "DIAGNOSIS.md",
	metrics: "METRICS.md",
	backlog: "BACKLOG.md",
	response: "RESPONSE.md",
	feedback: "FEEDBACK.md",
	manifest: "run.json",
	report: "REPORT.md",
	checklist: "CHECKLIST.md",
} as const;

export type StageName = "bootstrap" | "develop" | "evaluate" | "learning" | "report" | "checklist";
export type WorkflowStatus = "running" | "success" | "failed";
export type StageStatus = "pending" | "running" | "success" | "failed";
export type DirectivePolicy = "OPTIMIZATION" | "CREATIVITY/EXPLORATION";
export type ResumeFailureCategory = "bootstrap_failed" | "loop_develop_failed" | "loop_evaluate_failed" | "report_failed" | "checklist_failed" | "unknown_failed";

export interface StageUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
	contextTokens: number;
}

export interface StageExecutionResult {
	text: string;
	exitCode: number;
	stderr: string;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	usage: StageUsage;
}

export type PiStageStreamEvent =
	| { type: "thinking_start" }
	| { type: "thinking_delta"; delta: string }
	| { type: "thinking_end" }
	| { type: "toolcall_start" }
	| { type: "toolcall_end"; toolName?: string }
	| { type: "text_start" }
	| { type: "text_end" }
	| { type: "tool_execution_start"; toolName: string; args?: unknown }
	| { type: "tool_execution_end"; toolName: string; isError: boolean }
	| { type: "message_end"; text?: string; model?: string; stopReason?: string; errorMessage?: string };

export type WorkflowProgressEventType =
	| "workflow_started"
	| "stage_started"
	| "stage_progress"
	| "thinking"
	| "tool_start"
	| "tool_end"
	| "stage_completed"
	| "stage_failed"
	| "loop_completed"
	| "workflow_completed"
	| "workflow_failed";

export interface WorkflowProgressEvent {
	type: WorkflowProgressEventType;
	relativeCallDir: string;
	requestedLoops: number;
	completedLoops: number;
	message: string;
	stageName?: StageName;
	stageStatus?: StageStatus;
	loopNumber?: number;
	toolName?: string;
	toolArgs?: unknown;
	thinkingDelta?: string;
	score?: number;
	isError?: boolean;
}

export interface StageRecord {
	name: StageName;
	status: StageStatus;
	startedAt?: string;
	completedAt?: string;
	logPath: string;
	stderrPath: string;
	exitCode?: number;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	usage?: StageUsage;
}

export interface C7Snapshot {
	hasChanges: boolean;
	diffSummary: string;
	changedFiles: number;
}

export interface LoopManifestEntry {
	loopNumber: number;
	randomNumber: number;
	startedAt: string;
	completedAt?: string;
	score?: number;
	c7Snapshot?: C7Snapshot;
	responsePath: string;
	feedbackPath: string;
	learningPath: string;
	stages: {
		develop: StageRecord;
		evaluate: StageRecord;
		learning: StageRecord;
	};
}

export interface ResumeMetadata {
	sourceCallDir: string;
	sourceCallId: string;
	sourceStatus: WorkflowStatus;
	sourceRequestedLoops: number;
	lastConsistentLoop: number;
	resumeFailureCategory: ResumeFailureCategory;
	workaroundInstructions: string;
}

export interface ResumeSourceAnalysis {
	sourceCallDir: string;
	sourceRelativeCallDir: string;
	sourceManifestPath: string;
	sourceManifest: WorkflowManifest;
	failureCategory: ResumeFailureCategory;
	lastConsistentLoop: number;
	lastConsistentScore?: number;
	bootstrapConsistent: boolean;
	failedLoopNumber?: number;
	recommendedStartLoop: number;
	canSkipBootstrap: boolean;
	shouldRunFinalStagesOnly: boolean;
	failureReason?: string;
	missingArtifacts: string[];
}

export interface WorkflowManifest {
	schemaVersion: number;
	status: WorkflowStatus;
	cwd: string;
	callNumber: number;
	callId: string;
	callDir: string;
	startedAt: string;
	completedAt?: string;
	requestedLoops: number;
	completedLoops: number;
	model?: string;
	thinkingLevel?: string;
	initialRandomNumber?: number;
	directivePolicy?: DirectivePolicy;
	resume?: ResumeMetadata;
	files: {
		idea: string;
		directive: string;
		learning: string;
		criteria: string;
		diagnosis: string;
		metrics: string;
		backlog: string;
		response: string;
		feedback: string;
		report: string;
		checklist: string;
	};
	bootstrap: StageRecord;
	report: StageRecord;
	checklist: StageRecord;
	loops: LoopManifestEntry[];
	assumptions: string[];
	lastError?: string;
}
