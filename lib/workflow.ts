import path from "node:path";
import { promises as fs } from "node:fs";
import { extractMarkedSections } from "./marker-parser.ts";
import { generateRandomNumber } from "./number-generator.ts";
import { writeMarkdownFile } from "./io.ts";
import { createInitialManifest, createLoopEntry, markStageFailure, markStageRunning, markStageSuccess, saveManifest } from "./manifest.ts";
import { diffSnapshots, formatSnapshotDiff, takeSnapshot, type SnapshotDiff } from "./post-hoc-check.ts";
import { ensureLoopDirectory, findNextCallNumber, prepareCallWorkspace, toProjectRelativePath } from "./path-utils.ts";
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
import type { DirectivePolicy, PiStageStreamEvent, StageExecutionResult, StageName, StageRecord, WorkflowManifest, WorkflowProgressEvent } from "./types.ts";
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
}): Promise<Record<string, string>> {
	const { cwd, workspace, loops, modelPattern, thinkingLevel, manifest, relativeCallDir, onStatus, onEvent, runtimeControl, invocation, randomNumber, policy } = options;

	const BOOTSTRAP_MAX_RETRIES = 3;
	const BOOTSTRAP_REQUIRED_FILES = ["DIRECTIVE.md", "LEARNING.md", "CRITERIA.md", "DIAGNOSIS.md", "METRICS.md", "BACKLOG.md"];
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
				userPrompt: buildInitialArtifactsUserPrompt({
					cwd,
					workspace,
					randomNumber,
					policy,
				}),
				manifest,
				manifestPath: workspace.rootFiles.manifest,
				onStatus,
				onEvent,
				statusMessage: `Generating initial artifacts in ${relativeCallDir}${attempt > 1 ? ` (attempt ${attempt}/${BOOTSTRAP_MAX_RETRIES})` : ""}`,
				resultValidator: (result) => {
					extractMarkedSections(result.text, BOOTSTRAP_REQUIRED_FILES);
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
			if (parseError instanceof StageValidationError) {
				await writeMarkdownFile(rawPath, parseError.result.text);
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
}): Promise<{ score?: number }> {
	const { cwd, workspace, loopNumber, loops, modelPattern, thinkingLevel, manifest, relativeCallDir, onStatus, onEvent, runtimeControl, invocation } = options;
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
		userPrompt: buildDevelopmentUserPrompt({
			cwd,
			workspace,
			loopNumber,
			requestedLoops: loops,
			randomNumber: loopRandomNumber,
		}),
		manifest,
		manifestPath: workspace.rootFiles.manifest,
		onStatus,
		onEvent,
		statusMessage: `Loop ${loopNumber}/${loops}: developing RESPONSE.md`,
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
				userPrompt: buildEvaluateLearningUserPrompt({
					cwd,
					workspace,
					loopNumber,
					requestedLoops: loops,
				}),
				manifest,
				manifestPath: workspace.rootFiles.manifest,
				onStatus,
				onEvent,
				statusMessage: `Loop ${loopNumber}/${loops}: evaluating + updating learning${attempt > 1 ? ` (attempt ${attempt}/${EVALUATE_MAX_RETRIES})` : ""}`,
				resultValidator: (result) => {
					extractMarkedSections(result.text, [...EVALUATE_REQUIRED_FILES]);
				},
				runtimeControl,
				invocation,
			});
			evalLearnSections = extractMarkedSections(evaluateLearningResult.text, [...EVALUATE_REQUIRED_FILES]);
			break;
		} catch (parseError) {
			if (!isSectionExtractionError(parseError)) throw parseError;
			lastEvaluateParseError = parseError instanceof Error ? parseError : new Error(String(parseError));
			const rawPath = path.join(loopDir, `evaluate-raw-attempt-${attempt}.md`);
			if (parseError instanceof StageValidationError) {
				await writeMarkdownFile(rawPath, parseError.result.text);
			} else if (evaluateLearningResult) {
				await writeMarkdownFile(rawPath, evaluateLearningResult.text);
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
}): Promise<void> {
	const { cwd, workspace, loops, modelPattern, thinkingLevel, manifest, relativeCallDir, onStatus, onEvent, runtimeControl, invocation } = options;
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
		userPrompt: buildReportUserPrompt({
			cwd,
			workspace,
			requestedLoops: loops,
			completedLoops: manifest.completedLoops,
		}),
		manifest,
		manifestPath: workspace.rootFiles.manifest,
		onStatus,
		onEvent,
		statusMessage: `Consolidating final report: REPORT.md`,
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
		userPrompt: buildChecklistUserPrompt({
			cwd,
			workspace,
			requestedLoops: loops,
			completedLoops: manifest.completedLoops,
		}),
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

export async function runIdeaRefinementWorkflow(input: WorkflowRunInput): Promise<WorkflowRunResult> {
	const { cwd, idea, loops, modelPattern, thinkingLevel, onStatus, onEvent, runtimeControl, invocation } = input;
	runtimeControl?.ensureNotStopped();
	const callNumber = await findNextCallNumber(path.join(cwd, "docs", "idea_refinement"));
	const workspace = await prepareCallWorkspace(cwd, callNumber);
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
