import type { CallWorkspace } from "./path-utils.ts";
import { toProjectRelativePath } from "./path-utils.ts";
import type { LoopManifestEntry, StageExecutionResult, StageName, StageRecord, WorkflowManifest } from "./types.ts";
import { writeJsonFile } from "./io.ts";

export function createStageRecord(name: StageName, logPath: string, stderrPath: string): StageRecord {
	return {
		name,
		status: "pending",
		logPath,
		stderrPath,
	};
}

export function createInitialManifest(options: {
	cwd: string;
	workspace: CallWorkspace;
	callNumber: number;
	requestedLoops: number;
	model?: string;
	thinkingLevel?: string;
	assumptions: string[];
}): WorkflowManifest {
	const { cwd, workspace, callNumber, requestedLoops, model, thinkingLevel, assumptions } = options;
	const relativeCallDir = toProjectRelativePath(cwd, workspace.callDir);

	return {
		schemaVersion: 1,
		status: "running",
		cwd,
		callNumber,
		callId: relativeCallDir.split("/").pop() ?? relativeCallDir,
		callDir: relativeCallDir,
		startedAt: new Date().toISOString(),
		requestedLoops,
		completedLoops: 0,
		model,
		thinkingLevel,
		files: {
			idea: toProjectRelativePath(cwd, workspace.rootFiles.idea),
			directive: toProjectRelativePath(cwd, workspace.rootFiles.directive),
			learning: toProjectRelativePath(cwd, workspace.rootFiles.learning),
			criteria: toProjectRelativePath(cwd, workspace.rootFiles.criteria),
			diagnosis: toProjectRelativePath(cwd, workspace.rootFiles.diagnosis),
			metrics: toProjectRelativePath(cwd, workspace.rootFiles.metrics),
			backlog: toProjectRelativePath(cwd, workspace.rootFiles.backlog),
			response: toProjectRelativePath(cwd, workspace.rootFiles.response),
			feedback: toProjectRelativePath(cwd, workspace.rootFiles.feedback),
			report: toProjectRelativePath(cwd, workspace.rootFiles.report),
			checklist: toProjectRelativePath(cwd, workspace.rootFiles.checklist),
		},
		bootstrap: createStageRecord(
			"bootstrap",
			toProjectRelativePath(cwd, `${workspace.logsDir}/bootstrap.jsonl`),
			toProjectRelativePath(cwd, `${workspace.logsDir}/bootstrap.stderr.log`),
		),
		report: createStageRecord(
			"report",
			toProjectRelativePath(cwd, `${workspace.logsDir}/report.jsonl`),
			toProjectRelativePath(cwd, `${workspace.logsDir}/report.stderr.log`),
		),
		checklist: createStageRecord(
			"checklist",
			toProjectRelativePath(cwd, `${workspace.logsDir}/checklist.jsonl`),
			toProjectRelativePath(cwd, `${workspace.logsDir}/checklist.stderr.log`),
		),
		loops: [],
		assumptions,
	};
}

export function createLoopEntry(options: {
	cwd: string;
	loopNumber: number;
	randomNumber: number;
	loopDir: string;
	logsDir: string;
}): LoopManifestEntry {
	const { cwd, loopNumber, randomNumber, loopDir, logsDir } = options;
	const prefix = `loop_${String(loopNumber).padStart(2, "0")}`;

	return {
		loopNumber,
		randomNumber,
		startedAt: new Date().toISOString(),
		responsePath: toProjectRelativePath(cwd, `${loopDir}/RESPONSE.md`),
		feedbackPath: toProjectRelativePath(cwd, `${loopDir}/FEEDBACK.md`),
		learningPath: toProjectRelativePath(cwd, `${loopDir}/LEARNING.md`),
		stages: {
			develop: createStageRecord(
				"develop",
				toProjectRelativePath(cwd, `${logsDir}/${prefix}_develop.jsonl`),
				toProjectRelativePath(cwd, `${logsDir}/${prefix}_develop.stderr.log`),
			),
			evaluate: createStageRecord(
				"evaluate",
				toProjectRelativePath(cwd, `${logsDir}/${prefix}_evaluate.jsonl`),
				toProjectRelativePath(cwd, `${logsDir}/${prefix}_evaluate.stderr.log`),
			),
			learning: createStageRecord(
				"learning",
				toProjectRelativePath(cwd, `${logsDir}/${prefix}_learning.jsonl`),
				toProjectRelativePath(cwd, `${logsDir}/${prefix}_learning.stderr.log`),
			),
		},
	};
}

export function markStageRunning(record: StageRecord): void {
	record.status = "running";
	record.startedAt = new Date().toISOString();
	record.completedAt = undefined;
	record.exitCode = undefined;
	record.errorMessage = undefined;
	record.stopReason = undefined;
	record.usage = undefined;
}

export function markStageSuccess(record: StageRecord, result: StageExecutionResult): void {
	record.status = "success";
	record.completedAt = new Date().toISOString();
	record.exitCode = result.exitCode;
	record.model = result.model;
	record.stopReason = result.stopReason;
	record.errorMessage = result.errorMessage;
	record.usage = result.usage;
}

export function markStageFailure(record: StageRecord, error: unknown): void {
	record.status = "failed";
	record.completedAt = new Date().toISOString();
	record.errorMessage = error instanceof Error ? error.message : String(error);
}

export async function saveManifest(manifestPath: string, manifest: WorkflowManifest): Promise<void> {
	await writeJsonFile(manifestPath, manifest);
}
