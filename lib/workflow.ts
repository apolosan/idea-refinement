import path from "node:path";
import { promises as fs } from "node:fs";
import { extractMarkedSections } from "./marker-parser.ts";
import { generateRandomNumber } from "./number-generator.ts";
import { writeMarkdownFile, normalizeMarkdown } from "./io.ts";
import { createInitialManifest, createLoopEntry, createStageRecord, markStageFailure, markStageRunning, markStageSuccess, saveManifest } from "./manifest.ts";
import { diffSnapshots, formatSnapshotDiff, takeSnapshot, type SnapshotDiff } from "./post-hoc-check.ts";
import { ensureLoopDirectory, findNextCallNumber, prepareCallWorkspace, toProjectRelativePath } from "./path-utils.ts";
import {
	buildChecklistUserPrompt,
	buildDevelopmentUserPrompt,
	buildEvaluateLearningUserPrompt,
	buildEvaluationUserPrompt,
	buildInitialArtifactsUserPrompt,
	buildLearningUpdateUserPrompt,
	buildReportUserPrompt,
	CHECKLIST_SYSTEM_PROMPT,
	DEVELOPMENT_SYSTEM_PROMPT,
	EVALUATE_LEARNING_SYSTEM_PROMPT,
	EVALUATION_SYSTEM_PROMPT,
	INITIAL_ARTIFACTS_SYSTEM_PROMPT,
	LEARNING_UPDATE_SYSTEM_PROMPT,
	REPORT_SYSTEM_PROMPT,
	WORKFLOW_ASSUMPTIONS,
} from "./prompts.ts";
import { runPiStage } from "./runner.ts";
import type { DirectivePolicy, PiStageStreamEvent, StageExecutionResult, StageName, StageRecord, WorkflowManifest, WorkflowProgressEvent } from "./types.ts";
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
	/** T3 fix: Optional invocation override for testing. */
	invocation?: { command: string; args?: string[] };
}

export interface WorkflowRunResult {
	callDir: string;
	relativeCallDir: string;
	manifest: WorkflowManifest;
	latestScore?: number;
}

function stagePaths(cwd: string, record: StageRecord): { logPath: string; stderrPath: string } {
	return {
		logPath: path.resolve(cwd, record.logPath),
		stderrPath: path.resolve(cwd, record.stderrPath),
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
	manifest: WorkflowManifest;
	manifestPath: string;
	onStatus?: (message: string | undefined) => void;
	onEvent?: (event: WorkflowProgressEvent) => void;
	statusMessage: string;
	/** D6 fix: Optional timeout override for this stage (ms). */
	timeoutMs?: number;
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
		manifest,
		manifestPath,
		onStatus,
		onEvent,
		statusMessage,
		timeoutMs,
		invocation,
	} = options;
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
		const paths = stagePaths(cwd, record);
		const result = await runPiStage({
			cwd,
			model: modelPattern,
			thinkingLevel,
			systemPrompt,
			userPrompt,
			logPath: paths.logPath,
			stderrPath: paths.stderrPath,
			protectedRoots,
			invocation,
			timeoutMs,
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

export async function runIdeaRefinementWorkflow(input: WorkflowRunInput): Promise<WorkflowRunResult> {
	const { cwd, idea, loops, modelPattern, thinkingLevel, onStatus, onEvent, invocation } = input;
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

		// Retry logic for bootstrap stage: the LLM may fail to produce proper markers
		const BOOTSTRAP_MAX_RETRIES = 3;
		const BOOTSTRAP_REQUIRED_FILES = ["DIRECTIVE.md", "LEARNING.md", "CRITERIA.md", "DIAGNOSIS.md", "METRICS.md", "BACKLOG.md"];
		let sections: Record<string, string> | undefined;
		let lastBootstrapError: Error | undefined;

		for (let attempt = 1; attempt <= BOOTSTRAP_MAX_RETRIES; attempt++) {
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
					randomNumber: initialRandomNumber,
					policy: directivePolicy,
				}),
				manifest,
				manifestPath: workspace.rootFiles.manifest,
				onStatus,
				onEvent,
				statusMessage: `Generating initial artifacts in ${relativeCallDir}${attempt > 1 ? ` (attempt ${attempt}/${BOOTSTRAP_MAX_RETRIES})` : ""}`,
				invocation,
			});

			try {
				sections = extractMarkedSections(bootstrapResult.text, BOOTSTRAP_REQUIRED_FILES);
				break; // Success — exit retry loop
			} catch (parseError) {
				lastBootstrapError = parseError instanceof Error ? parseError : new Error(String(parseError));
				const rawPath = path.join(workspace.callDir, `bootstrap-raw-attempt-${attempt}.md`);
				await writeMarkdownFile(rawPath, bootstrapResult.text);
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

		for (let loopNumber = 1; loopNumber <= loops; loopNumber += 1) {
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

			// Snapshot C7: capture before develop to detect material changes
			// C2 fix: Snapshot C7 captures project source (cwd), not extension source
			const snapshotBefore = await takeSnapshot(cwd, { scope: ["lib", "tests"], maxDepth: 6, maxFiles: 5000 });

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
				invocation,
				// D6 fix: Develop stage gets 15 min (code execution can be slow);
				// other stages keep the 10 min default.
				timeoutMs: 15 * 60 * 1000,
			});
			await writeMarkdownFile(workspace.rootFiles.response, developResult.text);
			await writeMarkdownFile(path.join(loopDir, "RESPONSE.md"), developResult.text);

			// Snapshot C7: compare before/after and store diff in loopEntry
			// C2 fix: Snapshot C7 after develop also uses cwd (project root)
			const snapshotAfter = await takeSnapshot(cwd, { scope: ["lib", "tests"], maxDepth: 6, maxFiles: 5000 });
			const c7Diff: SnapshotDiff = diffSnapshots(snapshotBefore, snapshotAfter);
			loopEntry.c7Snapshot = {
				hasChanges: c7Diff.hasChanges,
				diffSummary: formatSnapshotDiff(c7Diff),
				changedFiles: c7Diff.changed.length + c7Diff.added.length,
			};

			// If C7=0 (no material changes), emit WARNING notification
			if (!c7Diff.hasChanges) {
				const warningMsg = `⚠ Loop ${loopNumber}/${loops}: C7=0 — no material changes to source code after develop. This indicates pseudo-execution.`;
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
			const evaluateLearningResult = await runManagedStage({
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
				statusMessage: `Loop ${loopNumber}/${loops}: evaluating + updating learning`,
				invocation,
			});
			// Extract all three sections from the merged output
			const evalLearnSections = extractMarkedSections(evaluateLearningResult.text, ["FEEDBACK.md", "LEARNING.md", "BACKLOG.md"]);
			await writeMarkdownFile(workspace.rootFiles.feedback, evalLearnSections["FEEDBACK.md"]);
			await writeMarkdownFile(path.join(loopDir, "FEEDBACK.md"), evalLearnSections["FEEDBACK.md"]);

			loopEntry.score = extractOverallScore(evalLearnSections["FEEDBACK.md"]);
			if (typeof loopEntry.score === "number") latestScore = loopEntry.score;

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
				message: `Loop ${loopNumber}/${loops} completed${typeof loopEntry.score === "number" ? ` • score ${loopEntry.score}/100` : ""}`,
				loopNumber,
				score: loopEntry.score,
			});
		}

		// === Final consolidation stages: REPORT.md and CHECKLIST.md ===
		// After all loops, generate the two final artifacts that consolidate the entire investigation.

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
			invocation,
		});
		await writeMarkdownFile(workspace.rootFiles.checklist, checklistResult.text);

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
