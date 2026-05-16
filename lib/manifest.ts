import { promises as fs } from "node:fs";
import type { CallWorkspace } from "./path-utils.ts";
import { formatLoopNumber, toProjectRelativePath } from "./path-utils.ts";
import type {
	CarriedForwardStageMetadata,
	LoopCarriedForwardMetadata,
	LoopManifestEntry,
	LoopRawAttemptPaths,
	ResumeFailureCategory,
	StageExecutionResult,
	StageName,
	StageRecord,
	StageStatus,
	WorkflowManifest,
	WorkflowRawAttemptPaths,
	WorkflowStatus,
} from "./types.ts";
import { CURRENT_WORKFLOW_MANIFEST_SCHEMA_VERSION } from "./types.ts";
import { writeJsonFile } from "./io.ts";

export let manifestWriteCount = 0;

export function resetManifestWriteCount(): void {
	manifestWriteCount = 0;
}

function emptyLoopRawAttemptPaths(): LoopRawAttemptPaths {
	return {
		develop: [],
		evaluate: [],
		learning: [],
	};
}

function emptyWorkflowRawAttemptPaths(): WorkflowRawAttemptPaths {
	return {
		bootstrap: [],
		report: [],
		checklist: [],
	};
}

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
		schemaVersion: CURRENT_WORKFLOW_MANIFEST_SCHEMA_VERSION,
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
		auxiliaryFiles: {
			guardAuditLog: toProjectRelativePath(cwd, `${workspace.logsDir}/guard-denials.jsonl`),
		},
		rawAttemptPaths: emptyWorkflowRawAttemptPaths(),
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
		carriedForward: false,
		responsePath: toProjectRelativePath(cwd, `${loopDir}/RESPONSE.md`),
		feedbackPath: toProjectRelativePath(cwd, `${loopDir}/FEEDBACK.md`),
		learningPath: toProjectRelativePath(cwd, `${loopDir}/LEARNING.md`),
		backlogPath: toProjectRelativePath(cwd, `${loopDir}/BACKLOG.md`),
		rawAttemptPaths: emptyLoopRawAttemptPaths(),
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

export function createCarriedForwardLoopEntry(options: {
	cwd: string;
	loopNumber: number;
	randomNumber: number;
	loopDir: string;
	logsDir: string;
	source: LoopCarriedForwardMetadata;
	sourceStages: LoopManifestEntry["stages"];
	score?: number;
	c7Snapshot?: LoopManifestEntry["c7Snapshot"];
}): LoopManifestEntry {
	const { source, sourceStages, score, c7Snapshot, ...rest } = options;
	const entry = createLoopEntry(rest);
	entry.startedAt = undefined;
	entry.completedAt = undefined;
	entry.carriedForward = true;
	entry.seededFromRun = source.sourceCallId;
	entry.seededFromLoop = source.sourceLoopNumber;
	entry.carriedForwardAt = new Date().toISOString();
	entry.carriedForwardFrom = source;
	entry.score = score;
	entry.c7Snapshot = c7Snapshot;
	markStageCarriedForward(entry.stages.develop, {
		...source,
		sourceStageName: "develop",
		sourceStatus: sourceStages.develop.status,
		sourceLogPath: sourceStages.develop.logPath,
		sourceStderrPath: sourceStages.develop.stderrPath,
		sourceStartedAt: sourceStages.develop.startedAt,
		sourceCompletedAt: sourceStages.develop.completedAt,
		sourceModel: sourceStages.develop.model,
		sourceStopReason: sourceStages.develop.stopReason,
		sourceErrorMessage: sourceStages.develop.errorMessage,
	});
	markStageCarriedForward(entry.stages.evaluate, {
		...source,
		sourceStageName: "evaluate",
		sourceStatus: sourceStages.evaluate.status,
		sourceLogPath: sourceStages.evaluate.logPath,
		sourceStderrPath: sourceStages.evaluate.stderrPath,
		sourceStartedAt: sourceStages.evaluate.startedAt,
		sourceCompletedAt: sourceStages.evaluate.completedAt,
		sourceModel: sourceStages.evaluate.model,
		sourceStopReason: sourceStages.evaluate.stopReason,
		sourceErrorMessage: sourceStages.evaluate.errorMessage,
	});
	markStageCarriedForward(entry.stages.learning, {
		...source,
		sourceStageName: "learning",
		sourceStatus: sourceStages.learning.status,
		sourceLogPath: sourceStages.learning.logPath,
		sourceStderrPath: sourceStages.learning.stderrPath,
		sourceStartedAt: sourceStages.learning.startedAt,
		sourceCompletedAt: sourceStages.learning.completedAt,
		sourceModel: sourceStages.learning.model,
		sourceStopReason: sourceStages.learning.stopReason,
		sourceErrorMessage: sourceStages.learning.errorMessage,
	});
	return entry;
}

export function markStageRunning(record: StageRecord): void {
	record.status = "running";
	record.startedAt = new Date().toISOString();
	record.completedAt = undefined;
	record.exitCode = undefined;
	record.errorMessage = undefined;
	record.stopReason = undefined;
	record.usage = undefined;
	record.carriedForwardFrom = undefined;
}

export function markStageSuccess(record: StageRecord, result: StageExecutionResult): void {
	record.status = "success";
	record.completedAt = new Date().toISOString();
	record.exitCode = result.exitCode;
	record.model = result.model;
	record.stopReason = result.stopReason;
	record.errorMessage = result.errorMessage;
	record.usage = result.usage;
	record.carriedForwardFrom = undefined;
}

export function markStageFailure(record: StageRecord, error: unknown): void {
	record.status = "failed";
	record.completedAt = new Date().toISOString();
	record.errorMessage = error instanceof Error ? error.message : String(error);
	record.carriedForwardFrom = undefined;
}

export function markStagePending(record: StageRecord): void {
	record.status = "pending";
	record.startedAt = undefined;
	record.completedAt = undefined;
	record.exitCode = undefined;
	record.errorMessage = undefined;
	record.stopReason = undefined;
	record.usage = undefined;
	record.carriedForwardFrom = undefined;
}

export function markStageCarriedForward(record: StageRecord, source: CarriedForwardStageMetadata): void {
	record.status = "carried_forward";
	record.startedAt = undefined;
	record.completedAt = undefined;
	record.exitCode = undefined;
	record.model = undefined;
	record.stopReason = undefined;
	record.errorMessage = undefined;
	record.usage = undefined;
	record.carriedForwardFrom = source;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureObject(value: unknown, field: string, sourcePath: string): Record<string, unknown> {
	if (!isObject(value)) {
		throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be an object.`);
	}
	return value;
}

function ensureString(value: unknown, field: string, sourcePath: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be a non-empty string.`);
	}
	return value;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function ensureInteger(value: unknown, field: string, sourcePath: string, minimum = 0): number {
	if (!Number.isInteger(value) || (value as number) < minimum) {
		throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be an integer >= ${minimum}.`);
	}
	return value as number;
}

function ensureNumberInRange(value: unknown, field: string, sourcePath: string, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be a number between ${minimum} and ${maximum}.`);
	}
	return value;
}

function ensureWorkflowStatus(value: unknown, field: string, sourcePath: string): WorkflowStatus {
	if (value === "running" || value === "success" || value === "failed") return value;
	throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be one of running, success, failed.`);
}

function ensureDirectivePolicy(value: unknown, field: string, sourcePath: string): WorkflowManifest["directivePolicy"] {
	if (value === undefined) return undefined;
	if (value === "OPTIMIZATION" || value === "CREATIVITY/EXPLORATION") return value;
	throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be OPTIMIZATION or CREATIVITY/EXPLORATION.`);
}

function ensureResumeFailureCategory(value: unknown, field: string, sourcePath: string): ResumeFailureCategory {
	if (
		value === "bootstrap_failed"
		|| value === "loop_develop_failed"
		|| value === "loop_evaluate_failed"
		|| value === "report_failed"
		|| value === "checklist_failed"
		|| value === "unknown_failed"
	) {
		return value;
	}
	throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be a valid resume failure category.`);
}

function ensureStageStatus(value: unknown, field: string, sourcePath: string): StageStatus {
	if (value === "pending" || value === "running" || value === "success" || value === "failed" || value === "carried_forward") return value;
	throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be a valid stage status.`);
}

function ensureStageName(value: unknown, field: string, sourcePath: string): StageName {
	if (value === "bootstrap" || value === "develop" || value === "evaluate" || value === "learning" || value === "report" || value === "checklist") return value;
	throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be a valid stage name.`);
}

function ensureStringArray(value: unknown, field: string, sourcePath: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Invalid workflow manifest at ${sourcePath}: ${field} must be a string array.`);
	}
	return value as string[];
}

function normalizeRawAttemptPaths(value: unknown, field: string, sourcePath: string): LoopRawAttemptPaths {
	if (!isObject(value)) {
		return emptyLoopRawAttemptPaths();
	}
	return {
		develop: Array.isArray(value.develop) ? ensureStringArray(value.develop, `${field}.develop`, sourcePath) : [],
		evaluate: Array.isArray(value.evaluate) ? ensureStringArray(value.evaluate, `${field}.evaluate`, sourcePath) : [],
		learning: Array.isArray(value.learning) ? ensureStringArray(value.learning, `${field}.learning`, sourcePath) : [],
	};
}

function normalizeWorkflowRawAttemptPaths(value: unknown, field: string, sourcePath: string): WorkflowRawAttemptPaths {
	if (!isObject(value)) {
		return emptyWorkflowRawAttemptPaths();
	}
	return {
		bootstrap: Array.isArray(value.bootstrap) ? ensureStringArray(value.bootstrap, `${field}.bootstrap`, sourcePath) : [],
		report: Array.isArray(value.report) ? ensureStringArray(value.report, `${field}.report`, sourcePath) : [],
		checklist: Array.isArray(value.checklist) ? ensureStringArray(value.checklist, `${field}.checklist`, sourcePath) : [],
	};
}

function normalizeCarriedForwardStageMetadata(value: unknown, field: string, sourcePath: string): CarriedForwardStageMetadata | undefined {
	if (!isObject(value)) return undefined;
	return {
		sourceCallDir: ensureString(value.sourceCallDir, `${field}.sourceCallDir`, sourcePath),
		sourceCallId: ensureString(value.sourceCallId, `${field}.sourceCallId`, sourcePath),
		sourceLoopNumber: typeof value.sourceLoopNumber === "number" ? ensureInteger(value.sourceLoopNumber, `${field}.sourceLoopNumber`, sourcePath, 1) : undefined,
		sourceStageName: ensureStageName(value.sourceStageName, `${field}.sourceStageName`, sourcePath),
		sourceStatus: ensureStageStatus(value.sourceStatus, `${field}.sourceStatus`, sourcePath),
		sourceLogPath: optionalString(value.sourceLogPath),
		sourceStderrPath: optionalString(value.sourceStderrPath),
		sourceStartedAt: optionalString(value.sourceStartedAt),
		sourceCompletedAt: optionalString(value.sourceCompletedAt),
		sourceModel: optionalString(value.sourceModel),
		sourceStopReason: optionalString(value.sourceStopReason),
		sourceErrorMessage: optionalString(value.sourceErrorMessage),
	};
}

function normalizeStageRecord(value: unknown, field: string, sourcePath: string, fallbackName: StageName): StageRecord {
	const record = ensureObject(value, field, sourcePath);
	return {
		name: record.name === undefined ? fallbackName : ensureStageName(record.name, `${field}.name`, sourcePath),
		status: ensureStageStatus(record.status, `${field}.status`, sourcePath),
		startedAt: optionalString(record.startedAt),
		completedAt: optionalString(record.completedAt),
		logPath: ensureString(record.logPath, `${field}.logPath`, sourcePath),
		stderrPath: ensureString(record.stderrPath, `${field}.stderrPath`, sourcePath),
		exitCode: record.exitCode === undefined ? undefined : ensureInteger(record.exitCode, `${field}.exitCode`, sourcePath, 0),
		model: optionalString(record.model),
		stopReason: optionalString(record.stopReason),
		errorMessage: optionalString(record.errorMessage),
		usage: isObject(record.usage) ? {
			input: ensureInteger(record.usage.input, `${field}.usage.input`, sourcePath, 0),
			output: ensureInteger(record.usage.output, `${field}.usage.output`, sourcePath, 0),
			cacheRead: ensureInteger(record.usage.cacheRead, `${field}.usage.cacheRead`, sourcePath, 0),
			cacheWrite: ensureInteger(record.usage.cacheWrite, `${field}.usage.cacheWrite`, sourcePath, 0),
			cost: record.usage.cost === undefined ? 0 : ensureNumberInRange(record.usage.cost, `${field}.usage.cost`, sourcePath, 0, Number.MAX_SAFE_INTEGER),
			turns: ensureInteger(record.usage.turns, `${field}.usage.turns`, sourcePath, 0),
			contextTokens: ensureInteger(record.usage.contextTokens, `${field}.usage.contextTokens`, sourcePath, 0),
		} : undefined,
		carriedForwardFrom: normalizeCarriedForwardStageMetadata(record.carriedForwardFrom, `${field}.carriedForwardFrom`, sourcePath),
	};
}

function normalizeLoopCarriedForwardMetadata(value: unknown, field: string, sourcePath: string): LoopCarriedForwardMetadata | undefined {
	if (!isObject(value)) return undefined;
	return {
		sourceCallDir: ensureString(value.sourceCallDir, `${field}.sourceCallDir`, sourcePath),
		sourceCallId: ensureString(value.sourceCallId, `${field}.sourceCallId`, sourcePath),
		sourceLoopNumber: ensureInteger(value.sourceLoopNumber, `${field}.sourceLoopNumber`, sourcePath, 1),
	};
}

function normalizeLoopEntry(value: unknown, sourcePath: string, callDir: string): LoopManifestEntry {
	const record = ensureObject(value, "loops[]", sourcePath);
	const loopNumber = ensureInteger(record.loopNumber, "loops[].loopNumber", sourcePath, 1);
	const loopDir = `${callDir}/loops/loop_${formatLoopNumber(loopNumber)}`;
	const carriedForwardFrom = normalizeLoopCarriedForwardMetadata(record.carriedForwardFrom, `loops[${loopNumber}].carriedForwardFrom`, sourcePath);
	const carriedForward = typeof record.carriedForward === "boolean"
		? record.carriedForward
		: carriedForwardFrom !== undefined;
	const seededFromRun = optionalString(record.seededFromRun) ?? carriedForwardFrom?.sourceCallId;
	const seededFromLoop = typeof record.seededFromLoop === "number"
		? ensureInteger(record.seededFromLoop, `loops[${loopNumber}].seededFromLoop`, sourcePath, 1)
		: carriedForwardFrom?.sourceLoopNumber;
	return {
		loopNumber,
		randomNumber: ensureNumberInRange(
			ensureInteger(record.randomNumber, `loops[${loopNumber}].randomNumber`, sourcePath, 1),
			`loops[${loopNumber}].randomNumber`,
			sourcePath,
			1,
			100,
		),
		startedAt: optionalString(record.startedAt),
		completedAt: optionalString(record.completedAt),
		carriedForwardAt: optionalString(record.carriedForwardAt),
		carriedForwardFrom,
		carriedForward,
		seededFromRun,
		seededFromLoop,
		score: record.score === undefined ? undefined : ensureNumberInRange(record.score, `loops[${loopNumber}].score`, sourcePath, 1, 100),
		c7Snapshot: isObject(record.c7Snapshot) ? {
			hasChanges: record.c7Snapshot.hasChanges === true,
			diffSummary: ensureString(record.c7Snapshot.diffSummary, `loops[${loopNumber}].c7Snapshot.diffSummary`, sourcePath),
			changedFiles: ensureInteger(record.c7Snapshot.changedFiles, `loops[${loopNumber}].c7Snapshot.changedFiles`, sourcePath, 0),
		} : undefined,
		responsePath: ensureString(record.responsePath, `loops[${loopNumber}].responsePath`, sourcePath),
		feedbackPath: ensureString(record.feedbackPath, `loops[${loopNumber}].feedbackPath`, sourcePath),
		learningPath: ensureString(record.learningPath, `loops[${loopNumber}].learningPath`, sourcePath),
		backlogPath: optionalString(record.backlogPath) ?? `${loopDir}/BACKLOG.md`,
		rawAttemptPaths: normalizeRawAttemptPaths(record.rawAttemptPaths, `loops[${loopNumber}].rawAttemptPaths`, sourcePath),
		stages: {
			develop: normalizeStageRecord(record.stages && (record.stages as Record<string, unknown>).develop, `loops[${loopNumber}].stages.develop`, sourcePath, "develop"),
			evaluate: normalizeStageRecord(record.stages && (record.stages as Record<string, unknown>).evaluate, `loops[${loopNumber}].stages.evaluate`, sourcePath, "evaluate"),
			learning: normalizeStageRecord(record.stages && (record.stages as Record<string, unknown>).learning, `loops[${loopNumber}].stages.learning`, sourcePath, "learning"),
		},
	};
}

function normalizeResumeMetadata(value: unknown, sourcePath: string, loops: LoopManifestEntry[], fallbackResumeContextPath: string): WorkflowManifest["resume"] {
	if (!isObject(value)) return undefined;
	const carriedForwardLoopNumbers = Array.isArray(value.carriedForwardLoopNumbers)
		? value.carriedForwardLoopNumbers.map((item, index) => ensureInteger(item, `resume.carriedForwardLoopNumbers[${index}]`, sourcePath, 1))
		: loops.filter((loop) => loop.carriedForwardFrom).map((loop) => loop.loopNumber);
	return {
		sourceCallDir: ensureString(value.sourceCallDir, "resume.sourceCallDir", sourcePath),
		sourceCallId: ensureString(value.sourceCallId, "resume.sourceCallId", sourcePath),
		sourceStatus: ensureWorkflowStatus(value.sourceStatus, "resume.sourceStatus", sourcePath),
		sourceRequestedLoops: ensureInteger(value.sourceRequestedLoops, "resume.sourceRequestedLoops", sourcePath, 0),
		lastConsistentLoop: ensureInteger(value.lastConsistentLoop, "resume.lastConsistentLoop", sourcePath, 0),
		resumeFailureCategory: ensureResumeFailureCategory(value.resumeFailureCategory, "resume.resumeFailureCategory", sourcePath),
		workaroundInstructions: ensureString(value.workaroundInstructions, "resume.workaroundInstructions", sourcePath),
		resumeContextPath: optionalString(value.resumeContextPath) ?? fallbackResumeContextPath,
		carriedForwardLoopNumbers,
	};
}

function normalizeManifest(raw: unknown, sourcePath: string): WorkflowManifest {
	const root = ensureObject(raw, "manifest", sourcePath);
	if (root.schemaVersion === undefined) {
		throw new Error(`Invalid workflow manifest at ${sourcePath}: schemaVersion is required.`);
	}
	const schemaVersion = ensureInteger(root.schemaVersion, "schemaVersion", sourcePath, 1);
	if (schemaVersion > CURRENT_WORKFLOW_MANIFEST_SCHEMA_VERSION) {
		throw new Error(
			`Incompatible workflow manifest at ${sourcePath}: schemaVersion ${schemaVersion} is newer than supported ${CURRENT_WORKFLOW_MANIFEST_SCHEMA_VERSION}.`,
		);
	}

	const cwd = ensureString(root.cwd, "cwd", sourcePath);
	const callDir = ensureString(root.callDir, "callDir", sourcePath);
	const files = ensureObject(root.files, "files", sourcePath);
	const normalizedLoops = Array.isArray(root.loops)
		? root.loops.map((loop) => normalizeLoopEntry(loop, sourcePath, callDir))
		: (() => { throw new Error(`Invalid workflow manifest at ${sourcePath}: loops must be an array.`); })();
	const auxiliaryFilesRecord = isObject(root.auxiliaryFiles) ? root.auxiliaryFiles : {};
	const fallbackResumeContextPath = optionalString(auxiliaryFilesRecord.resumeContext) ?? `${callDir}/RESUME_CONTEXT.md`;

	const normalizedManifest: WorkflowManifest = {
		schemaVersion: CURRENT_WORKFLOW_MANIFEST_SCHEMA_VERSION,
		status: ensureWorkflowStatus(root.status, "status", sourcePath),
		cwd,
		callNumber: ensureInteger(root.callNumber, "callNumber", sourcePath, 1),
		callId: ensureString(root.callId, "callId", sourcePath),
		callDir,
		startedAt: ensureString(root.startedAt, "startedAt", sourcePath),
		completedAt: optionalString(root.completedAt),
		requestedLoops: ensureInteger(root.requestedLoops, "requestedLoops", sourcePath, 0),
		completedLoops: ensureInteger(root.completedLoops, "completedLoops", sourcePath, 0),
		model: optionalString(root.model),
		thinkingLevel: optionalString(root.thinkingLevel),
		initialRandomNumber: root.initialRandomNumber === undefined ? undefined : ensureNumberInRange(
			ensureInteger(root.initialRandomNumber, "initialRandomNumber", sourcePath, 1),
			"initialRandomNumber",
			sourcePath,
			1,
			100,
		),
		directivePolicy: ensureDirectivePolicy(root.directivePolicy, "directivePolicy", sourcePath),
		resume: undefined,
		files: {
			idea: ensureString(files.idea, "files.idea", sourcePath),
			directive: ensureString(files.directive, "files.directive", sourcePath),
			learning: ensureString(files.learning, "files.learning", sourcePath),
			criteria: ensureString(files.criteria, "files.criteria", sourcePath),
			diagnosis: ensureString(files.diagnosis, "files.diagnosis", sourcePath),
			metrics: ensureString(files.metrics, "files.metrics", sourcePath),
			backlog: ensureString(files.backlog, "files.backlog", sourcePath),
			response: ensureString(files.response, "files.response", sourcePath),
			feedback: ensureString(files.feedback, "files.feedback", sourcePath),
			report: ensureString(files.report, "files.report", sourcePath),
			checklist: ensureString(files.checklist, "files.checklist", sourcePath),
		},
		auxiliaryFiles: {
			guardAuditLog: optionalString(auxiliaryFilesRecord.guardAuditLog) ?? `${callDir}/logs/guard-denials.jsonl`,
			resumeContext: fallbackResumeContextPath,
			responseValidatorOutput: optionalString(auxiliaryFilesRecord.responseValidatorOutput),
			lastValidatorCheckScore: auxiliaryFilesRecord.lastValidatorCheckScore === undefined ? undefined : ensureNumberInRange(auxiliaryFilesRecord.lastValidatorCheckScore, "auxiliaryFiles.lastValidatorCheckScore", sourcePath, 0, 85),
		},
		rawAttemptPaths: normalizeWorkflowRawAttemptPaths(root.rawAttemptPaths, "rawAttemptPaths", sourcePath),
		bootstrap: normalizeStageRecord(root.bootstrap, "bootstrap", sourcePath, "bootstrap"),
		report: normalizeStageRecord(root.report, "report", sourcePath, "report"),
		checklist: normalizeStageRecord(root.checklist, "checklist", sourcePath, "checklist"),
		loops: normalizedLoops,
		assumptions: Array.isArray(root.assumptions) ? ensureStringArray(root.assumptions, "assumptions", sourcePath) : [],
		lastError: optionalString(root.lastError),
	};

	normalizedManifest.resume = normalizeResumeMetadata(root.resume, sourcePath, normalizedLoops, fallbackResumeContextPath);
	if (normalizedManifest.completedLoops > normalizedManifest.requestedLoops) {
		throw new Error(`Invalid workflow manifest at ${sourcePath}: completedLoops cannot exceed requestedLoops.`);
	}
	const seenLoopNumbers = new Set<number>();
	for (const loop of normalizedLoops) {
		if (seenLoopNumbers.has(loop.loopNumber)) {
			throw new Error(`Invalid workflow manifest at ${sourcePath}: duplicate loopNumber ${loop.loopNumber}.`);
		}
		seenLoopNumbers.add(loop.loopNumber);
	}
	return normalizedManifest;
}

export async function readManifest(manifestPath: string): Promise<WorkflowManifest> {
	let text: string;
	try {
		text = await fs.readFile(manifestPath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			throw new Error(`Workflow manifest not found: ${manifestPath}`);
		}
		throw error;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`Invalid workflow manifest at ${manifestPath}: malformed JSON (${error instanceof Error ? error.message : String(error)}).`);
	}

	return normalizeManifest(parsed, manifestPath);
}

export async function saveManifest(manifestPath: string, manifest: WorkflowManifest): Promise<void> {
	manifestWriteCount++;
	await writeJsonFile(manifestPath, manifest);
}

export async function recordValidatorCheckOnManifest(options: {
	manifestPath: string;
	validatorOutputRelativePath: string;
	score: number;
}): Promise<void> {
	const manifest = await readManifest(options.manifestPath);
	manifest.auxiliaryFiles.responseValidatorOutput = options.validatorOutputRelativePath;
	manifest.auxiliaryFiles.lastValidatorCheckScore = options.score;
	await saveManifest(options.manifestPath, manifest);
}
