import path from "node:path";
import { promises as fs } from "node:fs";
import { extractMarkedSections } from "./marker-parser.ts";
import { generateRandomNumber } from "./number-generator.ts";
import { copyTextFileAtomic, writeMarkdownFile } from "./io.ts";
import { createInitialManifest, createLoopEntry, markStageFailure, markStageRunning, markStageSuccess, saveManifest } from "./manifest.ts";
import { diffSnapshots, formatSnapshotDiff, takeSnapshot, type SnapshotDiff } from "./post-hoc-check.ts";
import { allocateCallWorkspace, ensureLoopDirectory, getCallDirectoryName, getLoopDirectoryName, prepareCallWorkspace, toProjectRelativePath } from "./path-utils.ts";
import {
	buildChecklistUserPrompt,
	buildDevelopmentUserPrompt,
	buildEvaluateLearningUserPrompt,
	buildInitialArtifactsUserPrompt,
	buildReportUserPrompt,
	CHECKLIST_SYSTEM_PROMPT,
	DEVELOPMENT_SYSTEM_PROMPT,
	EVALUATE_LEARNING_SYSTEM_PROMPT,
	INITIAL_ARTIFACTS_SYSTEM_PROMPT,
	REPORT_SYSTEM_PROMPT,
	WORKFLOW_ASSUMPTIONS,
} from "./prompts.ts";
import { runPiStage, type UserPromptTransport } from "./runner.ts";
import type {
	DirectivePolicy,
	LoopManifestEntry,
	PiStageStreamEvent,
	ResumeSourceAnalysis,
	StageExecutionResult,
	StageName,
	StageRecord,
	WorkflowManifest,
	WorkflowProgressEvent,
} from "./types.ts";
import type { WorkflowRuntimeControl } from "./workflow-runtime-control.ts";
import { stageDisplayName, buildStageStatusMessage } from "./ui-monitor.ts";
import { determineDirectivePolicy, extractOverallScore } from "./validation.ts";

export interface WorkflowRunInput {
	cwd: string;
	idea: string;
	loops: number;
	modelPattern?: string;
	thinkingLevel?: string;
	onStatus?: (message: string | undefined) => void;
	onEvent?: (event: WorkflowProgressEvent) => void;
	runtimeControl?: WorkflowRuntimeControl;
	/** T3 fix: Optional invocation override for testing. */
	invocation?: { command: string; args?: string[] };
}

export interface WorkflowRunResult {
	callDir: string;
	relativeCallDir: string;
	manifest: WorkflowManifest;
	latestScore?: number;
}

export interface WorkflowResumeInput {
	cwd: string;
	sourceCallSpecifier: string;
	finalLoopCount: number;
	workaroundInstructions: string;
	modelPattern?: string;
	thinkingLevel?: string;
	onStatus?: (message: string | undefined) => void;
	onEvent?: (event: WorkflowProgressEvent) => void;
	runtimeControl?: WorkflowRuntimeControl;
	invocation?: { command: string; args?: string[] };
}

export interface WorkflowResumeResult extends WorkflowRunResult {
	resumeAnalysis: ResumeSourceAnalysis;
}




class StageValidationError extends Error {
	readonly result: StageExecutionResult;

	constructor(message: string, result: StageExecutionResult) {
		super(message);
		this.name = "StageValidationError";
		this.result = result;
	}
}

function isSectionExtractionError(error: unknown): error is Error {
	return error instanceof Error && /Missing marked section|insufficient content/.test(error.message);
}

function isRetryableEvaluateValidationError(error: unknown): error is Error {
	if (!(error instanceof Error)) return false;
	const message = error.message;
	return /Missing marked section|insufficient content/.test(message)
		|| /Missing or invalid Overall score in FEEDBACK\.md/.test(message);
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function resolveSourceCallDir(cwd: string, sourceCallSpecifier: string): string {
	const trimmed = sourceCallSpecifier.trim();
	if (!trimmed) throw new Error("Resume requires a failed run path or call index.");
	if (/^\d+$/.test(trimmed)) {
		return path.join(cwd, "docs", "idea_refinement", getCallDirectoryName(Number.parseInt(trimmed, 10)));
	}
	return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
}

function determineResumeFailureCategory(manifest: WorkflowManifest): ResumeSourceAnalysis["failureCategory"] {
	if (manifest.bootstrap.status !== "success") return "bootstrap_failed";
	if (manifest.report.status === "failed") return "report_failed";
	if (manifest.checklist.status === "failed") return "checklist_failed";

	const failedLoop = manifest.loops.find((loop) => loop.stages.evaluate.status === "failed" || loop.stages.learning.status === "failed" || loop.stages.develop.status === "failed");
	if (failedLoop?.stages.develop.status === "failed") return "loop_develop_failed";
	if (failedLoop && (failedLoop.stages.evaluate.status === "failed" || failedLoop.stages.learning.status === "failed")) return "loop_evaluate_failed";
	return "unknown_failed";
}

function extractFailedLoopNumber(manifest: WorkflowManifest): number | undefined {
	const failedLoop = manifest.loops.find((loop) => loop.stages.develop.status === "failed" || loop.stages.evaluate.status === "failed" || loop.stages.learning.status === "failed");
	return failedLoop?.loopNumber;
}

function buildResumePromptContext(analysis: ResumeSourceAnalysis, workaroundInstructions: string, finalLoopCount: number, resumeContextRelativePath: string): string {
	const missingArtifactsLine = analysis.missingArtifacts.length > 0 ? analysis.missingArtifacts.join(", ") : "none";
	const failureLoopLine = analysis.failedLoopNumber !== undefined ? String(analysis.failedLoopNumber) : "n/a";
	return [
		"",
		"Resume context:",
		`- Resume source run: ${analysis.sourceRelativeCallDir}`,
		`- Failure category: ${analysis.failureCategory}`,
		`- Failure reason: ${analysis.failureReason ?? "not recorded"}`,
		`- Last consistent loop: ${analysis.lastConsistentLoop}`,
		`- Failed loop (if any): ${failureLoopLine}`,
		`- Bootstrap can be reused: ${analysis.canSkipBootstrap ? "yes" : "no"}`,
		`- Final loop target for this resumed execution: ${finalLoopCount}`,
		`- Missing artifacts detected during analysis: ${missingArtifactsLine}`,
		`- Read the explicit resume instructions file before responding: ${resumeContextRelativePath}`,
		"- Respect the workaround instructions and focus on continuing from the last consistent state rather than restarting analysis from scratch.",
		"- Do not assume the failed partial loop is trustworthy unless explicitly restated in the resume instructions.",
		"",
		"User workaround instructions:",
		workaroundInstructions,
	].join("\n");
}

function buildResumeContextDocument(analysis: ResumeSourceAnalysis, workaroundInstructions: string, finalLoopCount: number): string {
	return [
		"# Resume Context",
		"",
		`- Source run: ${analysis.sourceRelativeCallDir}`,
		`- Failure category: ${analysis.failureCategory}`,
		`- Failure reason: ${analysis.failureReason ?? "not recorded"}`,
		`- Source requested loops: ${analysis.sourceManifest.requestedLoops}`,
		`- Last consistent loop: ${analysis.lastConsistentLoop}`,
		`- Recommended start loop: ${analysis.recommendedStartLoop}`,
		`- Final loop target for resumed execution: ${finalLoopCount}`,
		`- Bootstrap can be reused: ${analysis.canSkipBootstrap ? "yes" : "no"}`,
		`- Missing artifacts detected: ${analysis.missingArtifacts.length > 0 ? analysis.missingArtifacts.join(", ") : "none"}`,
		"",
		"## Workaround instructions",
		workaroundInstructions,
	].join("\n");
}

function cloneStageRecordForResume(target: StageRecord, source: StageRecord): void {
	target.status = source.status;
	target.startedAt = source.startedAt;
	target.completedAt = source.completedAt;
	target.exitCode = source.exitCode;
	target.model = source.model;
	target.stopReason = source.stopReason;
	target.errorMessage = source.errorMessage;
	target.usage = source.usage;
}

export async function analyzeFailedRunForResume(cwd: string, sourceCallSpecifier: string): Promise<ResumeSourceAnalysis> {
	const sourceCallDir = resolveSourceCallDir(cwd, sourceCallSpecifier);
	const sourceManifestPath = path.join(sourceCallDir, "run.json");
	const manifestRaw = JSON.parse(await fs.readFile(sourceManifestPath, "utf8")) as WorkflowManifest;
	if (manifestRaw.status !== "failed") {
		throw new Error(`Resume requires a failed run. Current status at ${sourceManifestPath}: ${manifestRaw.status}`);
	}

	const sourceRelativeCallDir = toProjectRelativePath(cwd, sourceCallDir);
	const missingArtifacts: string[] = [];
	const bootstrapRequiredPaths = [
		path.join(sourceCallDir, "IDEA.md"),
		path.join(sourceCallDir, "DIRECTIVE.md"),
		path.join(sourceCallDir, "CRITERIA.md"),
		path.join(sourceCallDir, "DIAGNOSIS.md"),
		path.join(sourceCallDir, "METRICS.md"),
		path.join(sourceCallDir, "LEARNING.md"),
		path.join(sourceCallDir, "BACKLOG.md"),
	];
	for (const artifactPath of bootstrapRequiredPaths) {
		if (!(await fileExists(artifactPath))) missingArtifacts.push(path.basename(artifactPath));
	}

	let lastConsistentLoop = 0;
	for (let loopNumber = 1; loopNumber <= manifestRaw.completedLoops; loopNumber += 1) {
		const loop = manifestRaw.loops.find((entry) => entry.loopNumber === loopNumber);
		if (!loop) break;
		const loopDir = path.join(sourceCallDir, "loops", getLoopDirectoryName(loopNumber));
		const filesOk = await Promise.all([
			fileExists(path.join(loopDir, "RESPONSE.md")),
			fileExists(path.join(loopDir, "FEEDBACK.md")),
			fileExists(path.join(loopDir, "LEARNING.md")),
			fileExists(path.join(loopDir, "BACKLOG.md")),
		]);
		const stagesOk = loop.stages.develop.status === "success" && loop.stages.evaluate.status === "success" && loop.stages.learning.status === "success";
		if (filesOk.every(Boolean) && stagesOk) lastConsistentLoop = loopNumber;
		else break;
	}

	const bootstrapConsistent = manifestRaw.bootstrap.status === "success" && missingArtifacts.length === 0;
	const failureCategory = determineResumeFailureCategory(manifestRaw);
	const failedLoopNumber = extractFailedLoopNumber(manifestRaw);
	const recommendedStartLoop = lastConsistentLoop + 1;
	const shouldRunFinalStagesOnly = bootstrapConsistent && lastConsistentLoop >= manifestRaw.requestedLoops;
	const lastConsistentScore = manifestRaw.loops.find((loop) => loop.loopNumber === lastConsistentLoop)?.score;

	return {
		sourceCallDir,
		sourceRelativeCallDir,
		sourceManifestPath,
		sourceManifest: manifestRaw,
		failureCategory,
		lastConsistentLoop,
		lastConsistentScore,
		bootstrapConsistent,
		failedLoopNumber,
		recommendedStartLoop,
		canSkipBootstrap: bootstrapConsistent,
		shouldRunFinalStagesOnly,
		failureReason: manifestRaw.lastError,
		missingArtifacts,
	};
}

function emitWorkflowEvent(
	onEvent: ((event: WorkflowProgressEvent) => void) | undefined,
	event: WorkflowProgressEvent,
): void {
	onEvent?.(event);
}

function mapPiStageEventToWorkflowEvent(options: {
	event: PiStageStreamEvent;
	relativeCallDir: string;
	requestedLoops: number;
	completedLoops: number;
	stageName: StageName;
	loopNumber?: number;
}): WorkflowProgressEvent | undefined {
	const { event, relativeCallDir, requestedLoops, completedLoops, stageName, loopNumber } = options;

	switch (event.type) {
		case "tool_execution_start":
			return {
				type: "tool_start",
				relativeCallDir,
				requestedLoops,
				completedLoops,
				stageName,
				loopNumber,
				message: `Tool ${event.toolName} started`,
				toolName: event.toolName,
			};
		case "tool_execution_end":
			return {
				type: "tool_end",
				relativeCallDir,
				requestedLoops,
				completedLoops,
				stageName,
				loopNumber,
				message: event.isError ? `Tool ${event.toolName} returned an error` : `Tool ${event.toolName} completed`,
				toolName: event.toolName,
				isError: event.isError,
			};
		default:
			return undefined;
	}
}

async function runManagedStage(options: {
	cwd: string;
	protectedRoots: string[];
	modelPattern?: string;
	thinkingLevel?: string;
	record: StageRecord;
	stageName: StageName;
	loopNumber?: number;
	requestedLoops: number;
	completedLoops: number;
	relativeCallDir: string;
	systemPrompt: string;
	userPrompt: string;
	userPromptTransport?: UserPromptTransport;
	manifest: WorkflowManifest;
	manifestPath: string;
	onStatus?: (message: string | undefined) => void;
	onEvent?: (event: WorkflowProgressEvent) => void;
	statusMessage: string;
	resultValidator?: (result: StageExecutionResult) => Promise<void> | void;
	earlySuccessValidator?: (normalizedAssistantText: string) => boolean;
	/** Inactivity timeout override for this stage (ms). Default handled by runner. */
	timeoutMs?: number;
	runtimeControl?: WorkflowRuntimeControl;
	/** T3 fix: Optional invocation override for testing. */
	invocation?: { command: string; args?: string[] };
}): Promise<StageExecutionResult> {
	const {
		cwd,
		protectedRoots,
		modelPattern,
		thinkingLevel,
		record,
		stageName,
		loopNumber,
		requestedLoops,
		completedLoops,
		relativeCallDir,
		systemPrompt,
		userPrompt,
		userPromptTransport = "argv",
		manifest,
		manifestPath,
		onStatus,
		onEvent,
		statusMessage,
		resultValidator,
		earlySuccessValidator,
		timeoutMs,
		runtimeControl,
		invocation,
	} = options;
	runtimeControl?.ensureNotStopped();
	markStageRunning(record);
	await saveManifest(manifestPath, manifest);
	onStatus?.(statusMessage);
	emitWorkflowEvent(onEvent, {
		type: "stage_started",
		relativeCallDir,
		requestedLoops,
		completedLoops,
		message: statusMessage,
		stageName,
		stageStatus: record.status,
		loopNumber,
	});

	try {
		const logPath = path.resolve(cwd, record.logPath);
		const stderrPath = path.resolve(cwd, record.stderrPath);
		const result = await runPiStage({
			cwd,
			model: modelPattern,
			thinkingLevel,
			systemPrompt,
			userPrompt,
			userPromptTransport,
			logPath,
			stderrPath,
			protectedRoots,
			invocation,
			earlySuccessValidator,
			timeoutMs,
			runtimeControl,
			onProgress: (detail) => {
				const message = buildStageStatusMessage(statusMessage, detail);
				onStatus?.(message);
				emitWorkflowEvent(onEvent, {
					type: "stage_progress",
					relativeCallDir,
					requestedLoops,
					completedLoops,
					message,
					stageName,
					stageStatus: record.status,
					loopNumber,
				});
			},
			onEvent: (event) => {
				const mappedEvent = mapPiStageEventToWorkflowEvent({
					event,
					relativeCallDir,
					requestedLoops,
					completedLoops,
					stageName,
					loopNumber,
				});
				if (mappedEvent) emitWorkflowEvent(onEvent, mappedEvent);
			},
		});
		try {
			await resultValidator?.(result);
		} catch (validationError) {
			const message = validationError instanceof Error ? validationError.message : String(validationError);
			throw new StageValidationError(message, result);
		}
		markStageSuccess(record, result);
		await saveManifest(manifestPath, manifest);
		emitWorkflowEvent(onEvent, {
			type: "stage_completed",
			relativeCallDir,
			requestedLoops,
			completedLoops,
			message: `Stage completed: ${stageDisplayName(stageName)}${loopNumber ? ` (loop ${loopNumber}/${requestedLoops})` : ""}`,
			stageName,
			stageStatus: record.status,
			loopNumber,
		});
		return result;
	} catch (error) {
		markStageFailure(record, error);
		await saveManifest(manifestPath, manifest);
		emitWorkflowEvent(onEvent, {
			type: "stage_failed",
			relativeCallDir,
			requestedLoops,
			completedLoops,
			message: error instanceof Error ? error.message : String(error),
			stageName,
			stageStatus: record.status,
			loopNumber,
			isError: true,
		});
		throw error;
	}
}

async function runBootstrapStage(options: {
	cwd: string;
	workspace: Awaited<ReturnType<typeof prepareCallWorkspace>>;
	loops: number;
	modelPattern?: string;
	thinkingLevel?: string;
	manifest: WorkflowManifest;
	relativeCallDir: string;
	onStatus?: (message: string | undefined) => void;
	onEvent?: (event: WorkflowProgressEvent) => void;
	runtimeControl?: WorkflowRuntimeControl;
	invocation?: { command: string; args?: string[] };
	randomNumber: number;
	policy: DirectivePolicy;
	promptContext?: string;
}): Promise<Record<string, string>> {
	const { cwd, workspace, loops, modelPattern, thinkingLevel, manifest, relativeCallDir, onStatus, onEvent, runtimeControl, invocation, randomNumber, policy, promptContext } = options;

	const BOOTSTRAP_MAX_RETRIES = 3;
	const BOOTSTRAP_REQUIRED_FILES = ["DIRECTIVE.md", "LEARNING.md", "CRITERIA.md", "DIAGNOSIS.md", "METRICS.md", "BACKLOG.md"];
	const validateBootstrapText = (text: string): void => {
		extractMarkedSections(text, BOOTSTRAP_REQUIRED_FILES);
	};
	let sections: Record<string, string> | undefined;
	let lastBootstrapError: Error | undefined;

	for (let attempt = 1; attempt <= BOOTSTRAP_MAX_RETRIES; attempt++) {
		try {
			const bootstrapResult = await runManagedStage({
				cwd,
				protectedRoots: [workspace.callDir],
				modelPattern,
				thinkingLevel,
				record: manifest.bootstrap,
				stageName: "bootstrap",
				requestedLoops: loops,
				completedLoops: manifest.completedLoops,
				relativeCallDir,
				systemPrompt: INITIAL_ARTIFACTS_SYSTEM_PROMPT,
				userPrompt: [
					buildInitialArtifactsUserPrompt({
						cwd,
						workspace,
						randomNumber,
						policy,
					}),
					promptContext,
				].filter(Boolean).join("\n\n"),
				manifest,
				manifestPath: workspace.rootFiles.manifest,
				onStatus,
				onEvent,
				statusMessage: `Generating initial artifacts in ${relativeCallDir}${attempt > 1 ? ` (attempt ${attempt}/${BOOTSTRAP_MAX_RETRIES})` : ""}`,
				userPromptTransport: "stdin",
				earlySuccessValidator: (normalizedAssistantText) => {
					try {
						validateBootstrapText(normalizedAssistantText);
						return true;
					} catch {
						return false;
					}
				},
				resultValidator: (result) => {
					validateBootstrapText(result.text);
				},
				runtimeControl,
				invocation,
			});
			sections = extractMarkedSections(bootstrapResult.text, BOOTSTRAP_REQUIRED_FILES);
			break; // Success — exit retry loop
		} catch (parseError) {
			if (!isSectionExtractionError(parseError)) throw parseError;
			lastBootstrapError = parseError instanceof Error ? parseError : new Error(String(parseError));
			const rawPath = path.join(workspace.callDir, `bootstrap-raw-attempt-${attempt}.md`);
			try {
				if (parseError instanceof StageValidationError) {
					await writeMarkdownFile(rawPath, parseError.result.text);
				}
			} catch (rawWriteError) {
				// Best-effort: saving the raw attempt is for debugging only;
				// failure here must not break the retry flow.
				console.error(`[idea-refinement] Failed to save raw bootstrap attempt ${attempt}:`, rawWriteError);
			}
			onStatus?.(`⚠ Bootstrap attempt ${attempt}/${BOOTSTRAP_MAX_RETRIES} failed: ${lastBootstrapError.message}`);
			if (attempt === BOOTSTRAP_MAX_RETRIES) {
				throw new Error(
					`Failed to extract bootstrap sections after ${BOOTSTRAP_MAX_RETRIES} attempts; last raw text at ${rawPath}. Cause: ${lastBootstrapError.message}`,
				);
			}
		}
	}

	if (!sections) {
		throw new Error(`Bootstrap extraction failed unexpectedly. Last error: ${lastBootstrapError?.message}`);
	}
	await writeMarkdownFile(workspace.rootFiles.directive, sections["DIRECTIVE.md"]);
	await writeMarkdownFile(workspace.rootFiles.learning, sections["LEARNING.md"]);
	await writeMarkdownFile(workspace.rootFiles.criteria, sections["CRITERIA.md"]);
	await writeMarkdownFile(workspace.rootFiles.diagnosis, sections["DIAGNOSIS.md"]);
	await writeMarkdownFile(workspace.rootFiles.metrics, sections["METRICS.md"]);
	await writeMarkdownFile(workspace.rootFiles.backlog, sections["BACKLOG.md"]);
	await saveManifest(workspace.rootFiles.manifest, manifest);

	return sections;
}

async function runLoop(options: {
	cwd: string;
	workspace: Awaited<ReturnType<typeof prepareCallWorkspace>>;
	loopNumber: number;
	loops: number;
	modelPattern?: string;
	thinkingLevel?: string;
	manifest: WorkflowManifest;
	relativeCallDir: string;
	onStatus?: (message: string | undefined) => void;
	onEvent?: (event: WorkflowProgressEvent) => void;
	runtimeControl?: WorkflowRuntimeControl;
	invocation?: { command: string; args?: string[] };
	promptContext?: string;
}): Promise<{ score?: number }> {
	const { cwd, workspace, loopNumber, loops, modelPattern, thinkingLevel, manifest, relativeCallDir, onStatus, onEvent, runtimeControl, invocation, promptContext } = options;
	runtimeControl?.ensureNotStopped();

	const loopRandomNumber = generateRandomNumber();
	const loopDir = await ensureLoopDirectory(workspace, loopNumber);
	const loopEntry = createLoopEntry({
		cwd,
		loopNumber,
		randomNumber: loopRandomNumber,
		loopDir,
		logsDir: workspace.logsDir,
	});
	manifest.loops.push(loopEntry);
	await saveManifest(workspace.rootFiles.manifest, manifest);

	// Snapshot C7: capture refinement-artifact state before develop.
	const snapshotBefore = await takeSnapshot(workspace.callDir, {
		fileExtensions: [".md"],
		ignoreDirs: ["logs", "loops"],
		maxDepth: 3,
		maxFiles: 5000,
	});

	const developResult = await runManagedStage({
		cwd,
		protectedRoots: [workspace.callDir],
		modelPattern,
		thinkingLevel,
		record: loopEntry.stages.develop,
		stageName: "develop",
		loopNumber,
		requestedLoops: loops,
		completedLoops: manifest.completedLoops,
		relativeCallDir,
		systemPrompt: DEVELOPMENT_SYSTEM_PROMPT,
		userPrompt: [
			buildDevelopmentUserPrompt({
				cwd,
				workspace,
				loopNumber,
				requestedLoops: loops,
				randomNumber: loopRandomNumber,
			}),
			promptContext,
		].filter(Boolean).join("\n\n"),
		manifest,
		manifestPath: workspace.rootFiles.manifest,
		onStatus,
		onEvent,
		statusMessage: `Loop ${loopNumber}/${loops}: developing RESPONSE.md`,
		userPromptTransport: "stdin",
		runtimeControl,
		invocation,
	});
	await writeMarkdownFile(workspace.rootFiles.response, developResult.text);
	await writeMarkdownFile(path.join(loopDir, "RESPONSE.md"), developResult.text);

	// Snapshot C7: compare refinement-artifact state before/after develop output persistence.
	const snapshotAfter = await takeSnapshot(workspace.callDir, {
		fileExtensions: [".md"],
		ignoreDirs: ["logs", "loops"],
		maxDepth: 3,
		maxFiles: 5000,
	});
	const c7Diff: SnapshotDiff = diffSnapshots(snapshotBefore, snapshotAfter);
	loopEntry.c7Snapshot = {
		hasChanges: c7Diff.hasChanges,
		diffSummary: formatSnapshotDiff(c7Diff),
		changedFiles: c7Diff.changed.length + c7Diff.added.length,
	};

	// If C7=0 (no material changes), emit WARNING notification
	if (!c7Diff.hasChanges) {
		const warningMsg = `⚠ Loop ${loopNumber}/${loops}: C7=0 — no material changes to refinement artifacts after develop.`;
		onStatus?.(warningMsg);
		emitWorkflowEvent(onEvent, {
			type: "stage_progress",
			relativeCallDir,
			requestedLoops: loops,
			completedLoops: manifest.completedLoops,
			message: warningMsg,
			stageName: "develop",
			stageStatus: "running",
			loopNumber,
		});
	}

	// D5 fix: Merged evaluate+learning into a single subprocess call to eliminate
	// one cold-start per loop. The combined prompt produces FEEDBACK.md, LEARNING.md,
	// and BACKLOG.md in one pass, halving evaluate+learning overhead.
	const EVALUATE_REQUIRED_FILES = ["FEEDBACK.md", "LEARNING.md", "BACKLOG.md"] as const;
	const EVALUATE_MAX_RETRIES = 3;
	const validateEvaluateLearningText = (text: string): void => {
		const sections = extractMarkedSections(text, [...EVALUATE_REQUIRED_FILES]);
		const score = extractOverallScore(sections["FEEDBACK.md"] ?? "");
		if (typeof score !== "number") {
			throw new Error("Missing or invalid Overall score in FEEDBACK.md");
		}
	};
	let evaluateLearningResult: StageExecutionResult | undefined;
	let evalLearnSections: Record<string, string> | undefined;
	let lastEvaluateParseError: Error | undefined;

	for (let attempt = 1; attempt <= EVALUATE_MAX_RETRIES; attempt += 1) {
		try {
			evaluateLearningResult = await runManagedStage({
				cwd,
				protectedRoots: [workspace.callDir],
				modelPattern,
				thinkingLevel,
				record: loopEntry.stages.evaluate,
				stageName: "evaluate",
				loopNumber,
				requestedLoops: loops,
				completedLoops: manifest.completedLoops,
				relativeCallDir,
				systemPrompt: EVALUATE_LEARNING_SYSTEM_PROMPT,
				userPrompt: [
					buildEvaluateLearningUserPrompt({
						cwd,
						workspace,
						loopNumber,
						requestedLoops: loops,
					}),
					promptContext,
				].filter(Boolean).join("\n\n"),
				manifest,
				manifestPath: workspace.rootFiles.manifest,
				onStatus,
				onEvent,
				statusMessage: `Loop ${loopNumber}/${loops}: evaluating + updating learning${attempt > 1 ? ` (attempt ${attempt}/${EVALUATE_MAX_RETRIES})` : ""}`,
				userPromptTransport: "stdin",
				earlySuccessValidator: (normalizedAssistantText) => {
					try {
						validateEvaluateLearningText(normalizedAssistantText);
						return true;
					} catch {
						return false;
					}
				},
				resultValidator: (result) => {
					validateEvaluateLearningText(result.text);
				},
				runtimeControl,
				invocation,
			});
			evalLearnSections = extractMarkedSections(evaluateLearningResult.text, [...EVALUATE_REQUIRED_FILES]);
			break;
		} catch (parseError) {
			if (!isRetryableEvaluateValidationError(parseError)) throw parseError;
			lastEvaluateParseError = parseError instanceof Error ? parseError : new Error(String(parseError));
			const rawPath = path.join(loopDir, `evaluate-raw-attempt-${attempt}.md`);
			try {
				if (parseError instanceof StageValidationError) {
					await writeMarkdownFile(rawPath, parseError.result.text);
				} else if (evaluateLearningResult) {
					await writeMarkdownFile(rawPath, evaluateLearningResult.text);
				}
			} catch (rawWriteError) {
				// Best-effort: saving the raw attempt is for debugging only;
				// failure here must not break the retry flow.
				console.error(`[idea-refinement] Failed to save raw evaluate attempt ${attempt}:`, rawWriteError);
			}
			onStatus?.(`⚠ Loop ${loopNumber}/${loops}: evaluate output parse failed on attempt ${attempt}/${EVALUATE_MAX_RETRIES}: ${lastEvaluateParseError.message}`);
			if (attempt === EVALUATE_MAX_RETRIES) {
				throw new Error(
					`Failed to extract evaluate/learning sections after ${EVALUATE_MAX_RETRIES} attempts; last raw text at ${rawPath}. Cause: ${lastEvaluateParseError.message}`,
				);
			}
		}
	}

	if (!evaluateLearningResult || !evalLearnSections) {
		throw new Error(`Evaluate/learning extraction failed unexpectedly. Last error: ${lastEvaluateParseError?.message}`);
	}

	await writeMarkdownFile(workspace.rootFiles.feedback, evalLearnSections["FEEDBACK.md"]);
	await writeMarkdownFile(path.join(loopDir, "FEEDBACK.md"), evalLearnSections["FEEDBACK.md"]);

	const score = extractOverallScore(evalLearnSections["FEEDBACK.md"]);
	loopEntry.score = score;

	// Mark learning stage as success (derived from merged result)
	loopEntry.stages.learning.status = "success";
	loopEntry.stages.learning.startedAt = loopEntry.stages.evaluate.startedAt;
	loopEntry.stages.learning.completedAt = loopEntry.stages.evaluate.completedAt;
	loopEntry.stages.learning.exitCode = evaluateLearningResult.exitCode;
	loopEntry.stages.learning.model = evaluateLearningResult.model;
	loopEntry.stages.learning.stopReason = evaluateLearningResult.stopReason;
	loopEntry.stages.learning.usage = evaluateLearningResult.usage;

	await writeMarkdownFile(workspace.rootFiles.learning, evalLearnSections["LEARNING.md"]);
	await writeMarkdownFile(workspace.rootFiles.backlog, evalLearnSections["BACKLOG.md"]);
	await writeMarkdownFile(path.join(loopDir, "LEARNING.md"), evalLearnSections["LEARNING.md"]);
	await writeMarkdownFile(path.join(loopDir, "BACKLOG.md"), evalLearnSections["BACKLOG.md"]);

	loopEntry.completedAt = new Date().toISOString();
	manifest.completedLoops = loopNumber;
	await saveManifest(workspace.rootFiles.manifest, manifest);
	emitWorkflowEvent(onEvent, {
		type: "loop_completed",
		relativeCallDir,
		requestedLoops: loops,
		completedLoops: manifest.completedLoops,
		message: `Loop ${loopNumber}/${loops} completed${typeof score === "number" ? ` • score ${score}/100` : ""}`,
		loopNumber,
		score,
	});

	return { score };
}

async function runFinalStages(options: {
	cwd: string;
	workspace: Awaited<ReturnType<typeof prepareCallWorkspace>>;
	loops: number;
	modelPattern?: string;
	thinkingLevel?: string;
	manifest: WorkflowManifest;
	relativeCallDir: string;
	onStatus?: (message: string | undefined) => void;
	onEvent?: (event: WorkflowProgressEvent) => void;
	runtimeControl?: WorkflowRuntimeControl;
	invocation?: { command: string; args?: string[] };
	promptContext?: string;
}): Promise<void> {
	const { cwd, workspace, loops, modelPattern, thinkingLevel, manifest, relativeCallDir, onStatus, onEvent, runtimeControl, invocation, promptContext } = options;
	runtimeControl?.ensureNotStopped();

	// C1 fix: Use manifest.report directly instead of creating a local StageRecord
	const reportResult = await runManagedStage({
		cwd,
		protectedRoots: [workspace.callDir],
		modelPattern,
		thinkingLevel,
		record: manifest.report,
		stageName: "report",
		requestedLoops: loops,
		completedLoops: manifest.completedLoops,
		relativeCallDir,
		systemPrompt: REPORT_SYSTEM_PROMPT,
		userPrompt: [
			buildReportUserPrompt({
				cwd,
				workspace,
				requestedLoops: loops,
				completedLoops: manifest.completedLoops,
			}),
			promptContext,
		].filter(Boolean).join("\n\n"),
		manifest,
		manifestPath: workspace.rootFiles.manifest,
		onStatus,
		onEvent,
		statusMessage: `Consolidating final report: REPORT.md`,
		userPromptTransport: "stdin",
		runtimeControl,
		invocation,
	});
	await writeMarkdownFile(workspace.rootFiles.report, reportResult.text);

	// C1 fix: Use manifest.checklist directly instead of creating a local StageRecord
	const checklistResult = await runManagedStage({
		cwd,
		protectedRoots: [workspace.callDir],
		modelPattern,
		thinkingLevel,
		record: manifest.checklist,
		stageName: "checklist",
		requestedLoops: loops,
		completedLoops: manifest.completedLoops,
		relativeCallDir,
		systemPrompt: CHECKLIST_SYSTEM_PROMPT,
		userPrompt: [
			buildChecklistUserPrompt({
				cwd,
				workspace,
				requestedLoops: loops,
				completedLoops: manifest.completedLoops,
			}),
			promptContext,
		].filter(Boolean).join("\n\n"),
		manifest,
		manifestPath: workspace.rootFiles.manifest,
		onStatus,
		onEvent,
		statusMessage: `Generating action checklist: CHECKLIST.md`,
		userPromptTransport: "stdin",
		runtimeControl,
		invocation,
	});
	await writeMarkdownFile(workspace.rootFiles.checklist, checklistResult.text);
}

async function copyIfExists(sourcePath: string, targetPath: string): Promise<boolean> {
	return copyTextFileAtomic(sourcePath, targetPath);
}

async function seedResumedWorkspace(options: {
	cwd: string;
	workspace: Awaited<ReturnType<typeof prepareCallWorkspace>>;
	manifest: WorkflowManifest;
	analysis: ResumeSourceAnalysis;
	workaroundInstructions: string;
	finalLoopCount: number;
}): Promise<string> {
	const { cwd, workspace, manifest, analysis, workaroundInstructions, finalLoopCount } = options;
	const sourceCallDir = analysis.sourceCallDir;
	const resumeContextPath = path.join(workspace.callDir, "RESUME_CONTEXT.md");
	await writeMarkdownFile(resumeContextPath, buildResumeContextDocument(analysis, workaroundInstructions, finalLoopCount));

	const sourceIdeaPath = path.join(sourceCallDir, "IDEA.md");
	await copyIfExists(sourceIdeaPath, workspace.rootFiles.idea);

	manifest.resume = {
		sourceCallDir: analysis.sourceRelativeCallDir,
		sourceCallId: analysis.sourceManifest.callId,
		sourceStatus: analysis.sourceManifest.status,
		sourceRequestedLoops: analysis.sourceManifest.requestedLoops,
		lastConsistentLoop: analysis.lastConsistentLoop,
		resumeFailureCategory: analysis.failureCategory,
		workaroundInstructions,
	};
	manifest.initialRandomNumber = analysis.sourceManifest.initialRandomNumber;
	manifest.directivePolicy = analysis.sourceManifest.directivePolicy;

	if (!analysis.canSkipBootstrap) {
		return toProjectRelativePath(cwd, resumeContextPath);
	}

	await copyIfExists(path.join(sourceCallDir, "DIRECTIVE.md"), workspace.rootFiles.directive);
	await copyIfExists(path.join(sourceCallDir, "CRITERIA.md"), workspace.rootFiles.criteria);
	await copyIfExists(path.join(sourceCallDir, "DIAGNOSIS.md"), workspace.rootFiles.diagnosis);
	await copyIfExists(path.join(sourceCallDir, "METRICS.md"), workspace.rootFiles.metrics);

	if (analysis.lastConsistentLoop > 0) {
		const sourceLoopDir = path.join(sourceCallDir, "loops");
		for (let loopNumber = 1; loopNumber <= analysis.lastConsistentLoop; loopNumber += 1) {
			const loopDir = await ensureLoopDirectory(workspace, loopNumber);
			const sourceEntry = analysis.sourceManifest.loops.find((loop) => loop.loopNumber === loopNumber);
			if (!sourceEntry) break;
			await copyIfExists(path.join(sourceLoopDir, getLoopDirectoryName(loopNumber), "RESPONSE.md"), path.join(loopDir, "RESPONSE.md"));
			await copyIfExists(path.join(sourceLoopDir, getLoopDirectoryName(loopNumber), "FEEDBACK.md"), path.join(loopDir, "FEEDBACK.md"));
			await copyIfExists(path.join(sourceLoopDir, getLoopDirectoryName(loopNumber), "LEARNING.md"), path.join(loopDir, "LEARNING.md"));
			await copyIfExists(path.join(sourceLoopDir, getLoopDirectoryName(loopNumber), "BACKLOG.md"), path.join(loopDir, "BACKLOG.md"));

			const clonedLoop = createLoopEntry({
				cwd,
				loopNumber,
				randomNumber: sourceEntry.randomNumber,
				loopDir,
				logsDir: workspace.logsDir,
			});
			clonedLoop.startedAt = sourceEntry.startedAt;
			clonedLoop.completedAt = sourceEntry.completedAt;
			clonedLoop.score = sourceEntry.score;
			clonedLoop.c7Snapshot = sourceEntry.c7Snapshot;
			cloneStageRecordForResume(clonedLoop.stages.develop, sourceEntry.stages.develop);
			cloneStageRecordForResume(clonedLoop.stages.evaluate, sourceEntry.stages.evaluate);
			cloneStageRecordForResume(clonedLoop.stages.learning, sourceEntry.stages.learning);
			manifest.loops.push(clonedLoop);
		}

		const lastLoopDir = path.join(sourceCallDir, "loops", getLoopDirectoryName(analysis.lastConsistentLoop));
		await copyIfExists(path.join(lastLoopDir, "RESPONSE.md"), workspace.rootFiles.response);
		await copyIfExists(path.join(lastLoopDir, "FEEDBACK.md"), workspace.rootFiles.feedback);
		await copyIfExists(path.join(lastLoopDir, "LEARNING.md"), workspace.rootFiles.learning);
		await copyIfExists(path.join(lastLoopDir, "BACKLOG.md"), workspace.rootFiles.backlog);
		manifest.completedLoops = analysis.lastConsistentLoop;
	} else {
		await copyIfExists(path.join(sourceCallDir, "LEARNING.md"), workspace.rootFiles.learning);
		await copyIfExists(path.join(sourceCallDir, "BACKLOG.md"), workspace.rootFiles.backlog);
		manifest.completedLoops = 0;
	}

	cloneStageRecordForResume(manifest.bootstrap, analysis.sourceManifest.bootstrap);
	manifest.bootstrap.status = "success";
	return toProjectRelativePath(cwd, resumeContextPath);
}

export async function runIdeaRefinementResumeWorkflow(input: WorkflowResumeInput): Promise<WorkflowResumeResult> {
	const { cwd, sourceCallSpecifier, finalLoopCount, workaroundInstructions, modelPattern, thinkingLevel, onStatus, onEvent, runtimeControl, invocation } = input;
	runtimeControl?.ensureNotStopped();
	const analysis = await analyzeFailedRunForResume(cwd, sourceCallSpecifier);
	if (finalLoopCount < analysis.lastConsistentLoop) {
		throw new Error(`Final loop target ${finalLoopCount} is lower than the last consistent loop ${analysis.lastConsistentLoop}.`);
		}
	const { callNumber, workspace } = await allocateCallWorkspace(cwd);
	const relativeCallDir = toProjectRelativePath(cwd, workspace.callDir);
	const manifest = createInitialManifest({
		cwd,
		workspace,
		callNumber,
		requestedLoops: finalLoopCount,
		model: modelPattern,
		thinkingLevel,
		assumptions: [
			...WORKFLOW_ASSUMPTIONS,
			`Resume flow seeded from ${analysis.sourceRelativeCallDir}.`,
			`Resume failure category: ${analysis.failureCategory}.`,
		],
	});

	const resumeContextRelativePath = await seedResumedWorkspace({
		cwd,
		workspace,
		manifest,
		analysis,
		workaroundInstructions,
		finalLoopCount,
	});
	const promptContext = buildResumePromptContext(analysis, workaroundInstructions, finalLoopCount, resumeContextRelativePath);
	await saveManifest(workspace.rootFiles.manifest, manifest);
	emitWorkflowEvent(onEvent, {
		type: "workflow_started",
		relativeCallDir,
		requestedLoops: finalLoopCount,
		completedLoops: manifest.completedLoops,
		message: `Resume workflow started in ${relativeCallDir} from ${analysis.sourceRelativeCallDir}`,
	});

	let latestScore = analysis.lastConsistentScore;
	try {
		if (!analysis.canSkipBootstrap) {
			const initialRandomNumber = generateRandomNumber();
			const directivePolicy: DirectivePolicy = determineDirectivePolicy(initialRandomNumber);
			manifest.initialRandomNumber = initialRandomNumber;
			manifest.directivePolicy = directivePolicy;
			await saveManifest(workspace.rootFiles.manifest, manifest);
			await runBootstrapStage({
				cwd, workspace, loops: finalLoopCount, modelPattern, thinkingLevel, manifest, relativeCallDir,
				onStatus, onEvent, runtimeControl, invocation,
				randomNumber: initialRandomNumber, policy: directivePolicy, promptContext,
			});
		}

		for (let loopNumber = analysis.recommendedStartLoop; loopNumber <= finalLoopCount; loopNumber += 1) {
			const { score } = await runLoop({
				cwd, workspace, loopNumber, loops: finalLoopCount, modelPattern, thinkingLevel, manifest, relativeCallDir,
				onStatus, onEvent, runtimeControl, invocation, promptContext,
			});
			if (typeof score === "number") latestScore = score;
		}

		await runFinalStages({
			cwd, workspace, loops: finalLoopCount, modelPattern, thinkingLevel, manifest, relativeCallDir,
			onStatus, onEvent, runtimeControl, invocation, promptContext,
		});

		manifest.status = "success";
		manifest.completedAt = new Date().toISOString();
		await saveManifest(workspace.rootFiles.manifest, manifest);
		onStatus?.(`Resume workflow completed in ${relativeCallDir}`);
		emitWorkflowEvent(onEvent, {
			type: "workflow_completed",
			relativeCallDir,
			requestedLoops: finalLoopCount,
			completedLoops: manifest.completedLoops,
			message: `Resume workflow completed in ${relativeCallDir}`,
			score: latestScore,
		});

		return {
			callDir: workspace.callDir,
			relativeCallDir,
			manifest,
			latestScore,
			resumeAnalysis: analysis,
		};
	} catch (error) {
		manifest.status = "failed";
		manifest.completedAt = new Date().toISOString();
		manifest.lastError = error instanceof Error ? error.message : String(error);
		await saveManifest(workspace.rootFiles.manifest, manifest);
		onStatus?.(`Resume workflow failed: ${manifest.lastError}`);
		emitWorkflowEvent(onEvent, {
			type: "workflow_failed",
			relativeCallDir,
			requestedLoops: finalLoopCount,
			completedLoops: manifest.completedLoops,
			message: `Resume workflow failed: ${manifest.lastError}`,
			isError: true,
		});
		throw error;
	}
}

export async function runIdeaRefinementWorkflow(input: WorkflowRunInput): Promise<WorkflowRunResult> {
	const { cwd, idea, loops, modelPattern, thinkingLevel, onStatus, onEvent, runtimeControl, invocation } = input;
	runtimeControl?.ensureNotStopped();
	const { callNumber, workspace } = await allocateCallWorkspace(cwd);
	const relativeCallDir = toProjectRelativePath(cwd, workspace.callDir);
	const manifest = createInitialManifest({
		cwd,
		workspace,
		callNumber,
		requestedLoops: loops,
		model: modelPattern,
		thinkingLevel,
		assumptions: WORKFLOW_ASSUMPTIONS,
	});

	await writeMarkdownFile(workspace.rootFiles.idea, idea);
	await saveManifest(workspace.rootFiles.manifest, manifest);
	emitWorkflowEvent(onEvent, {
		type: "workflow_started",
		relativeCallDir,
		requestedLoops: loops,
		completedLoops: 0,
		message: `Workflow started in ${relativeCallDir}`,
	});

	let latestScore: number | undefined;

	try {
		const initialRandomNumber = generateRandomNumber();
		const directivePolicy: DirectivePolicy = determineDirectivePolicy(initialRandomNumber);
		manifest.initialRandomNumber = initialRandomNumber;
		manifest.directivePolicy = directivePolicy;
		await saveManifest(workspace.rootFiles.manifest, manifest);

		await runBootstrapStage({
			cwd, workspace, loops, modelPattern, thinkingLevel, manifest, relativeCallDir,
			onStatus, onEvent, runtimeControl, invocation,
			randomNumber: initialRandomNumber, policy: directivePolicy,
		});

		for (let loopNumber = 1; loopNumber <= loops; loopNumber += 1) {
			const { score } = await runLoop({
				cwd, workspace, loopNumber, loops, modelPattern, thinkingLevel, manifest, relativeCallDir,
				onStatus, onEvent, runtimeControl, invocation,
			});
			if (typeof score === "number") latestScore = score;
		}

		await runFinalStages({
			cwd, workspace, loops, modelPattern, thinkingLevel, manifest, relativeCallDir,
			onStatus, onEvent, runtimeControl, invocation,
		});

		// O4 fix: workflow_completed emitted AFTER report and checklist stages complete
		manifest.status = "success";
		manifest.completedAt = new Date().toISOString();
		await saveManifest(workspace.rootFiles.manifest, manifest);
		onStatus?.(`Workflow completed in ${relativeCallDir}`);
		emitWorkflowEvent(onEvent, {
			type: "workflow_completed",
			relativeCallDir,
			requestedLoops: loops,
			completedLoops: manifest.completedLoops,
			message: `Workflow completed in ${relativeCallDir}`,
			score: latestScore,
		});

		return {
			callDir: workspace.callDir,
			relativeCallDir,
			manifest,
			latestScore,
		};
	} catch (error) {
		manifest.status = "failed";
		manifest.completedAt = new Date().toISOString();
		manifest.lastError = error instanceof Error ? error.message : String(error);
		await saveManifest(workspace.rootFiles.manifest, manifest);
		onStatus?.(`Workflow failed: ${manifest.lastError}`);
		emitWorkflowEvent(onEvent, {
			type: "workflow_failed",
			relativeCallDir,
			requestedLoops: loops,
			completedLoops: manifest.completedLoops,
			message: `Workflow failed: ${manifest.lastError}`,
			isError: true,
		});
		throw error;
	}
}
