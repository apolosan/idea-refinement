import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { extractMarkedSections } from "./marker-parser.ts";
import { writeMarkdownFile, normalizeMarkdown } from "./io.ts";
import { createInitialManifest, createLoopEntry, createStageRecord, markStageFailure, markStageRunning, markStageSuccess, saveManifest } from "./manifest.ts";
import { diffSnapshots, formatSnapshotDiff, takeSnapshot, type SnapshotDiff } from "./post-hoc-check.ts";
import { ensureLoopDirectory, findNextCallNumber, prepareCallWorkspace, toProjectRelativePath } from "./path-utils.ts";
import {
	buildChecklistUserPrompt,
	buildDevelopmentUserPrompt,
	buildEvaluationUserPrompt,
	buildInitialArtifactsUserPrompt,
	buildLearningUpdateUserPrompt,
	buildReportUserPrompt,
	CHECKLIST_SYSTEM_PROMPT,
	DEVELOPMENT_SYSTEM_PROMPT,
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

async function ensureNumberGeneratorExists(cwd: string): Promise<string> {
	const numberGeneratorPath = path.join(cwd, "numberGenerator.js");
	await fs.access(numberGeneratorPath);
	return numberGeneratorPath;
}

async function generateRandomNumber(cwd: string): Promise<number> {
	const numberGeneratorPath = await ensureNumberGeneratorExists(cwd);

	const output = await new Promise<string>((resolve, reject) => {
		const proc = spawn(process.execPath, [numberGeneratorPath], {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});

		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		proc.on("error", (error) => reject(error));
		proc.on("close", (code) => {
			if ((code ?? 0) !== 0) {
				reject(new Error(stderr.trim() || `node numberGenerator.js failed with exit code ${code ?? 0}`));
				return;
			}
			resolve(stdout.trim());
		});
	});

	const parsed = Number.parseInt(output, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
		throw new Error(`numberGenerator.js must return an integer between 1 and 100. Received: ${output}`);
	}

	return parsed;
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
				message: `Ferramenta ${event.toolName} iniciada`,
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
				message: event.isError ? `Ferramenta ${event.toolName} retornou erro` : `Ferramenta ${event.toolName} concluída`,
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
			message: `Etapa concluída: ${stageDisplayName(stageName)}${loopNumber ? ` (loop ${loopNumber}/${requestedLoops})` : ""}`,
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
	const { cwd, idea, loops, modelPattern, thinkingLevel, onStatus, onEvent } = input;
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
		message: `Workflow iniciado em ${relativeCallDir}`,
	});

	let latestScore: number | undefined;

	try {
		const initialRandomNumber = await generateRandomNumber(cwd);
		const directivePolicy: DirectivePolicy = determineDirectivePolicy(initialRandomNumber);
		manifest.initialRandomNumber = initialRandomNumber;
		manifest.directivePolicy = directivePolicy;
		await saveManifest(workspace.rootFiles.manifest, manifest);

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
			statusMessage: `Gerando artefatos iniciais em ${relativeCallDir}`,
		});

		const sections = extractMarkedSections(bootstrapResult.text, [
			"DIRECTIVE.md",
			"LEARNING.md",
			"CRITERIA.md",
			"DIAGNOSIS.md",
			"METRICS.md",
			"BACKLOG.md",
		]);
		await writeMarkdownFile(workspace.rootFiles.directive, sections["DIRECTIVE.md"]);
		await writeMarkdownFile(workspace.rootFiles.learning, sections["LEARNING.md"]);
		await writeMarkdownFile(workspace.rootFiles.criteria, sections["CRITERIA.md"]);
		await writeMarkdownFile(workspace.rootFiles.diagnosis, sections["DIAGNOSIS.md"]);
		await writeMarkdownFile(workspace.rootFiles.metrics, sections["METRICS.md"]);
		await writeMarkdownFile(workspace.rootFiles.backlog, sections["BACKLOG.md"]);
		await saveManifest(workspace.rootFiles.manifest, manifest);

		for (let loopNumber = 1; loopNumber <= loops; loopNumber += 1) {
			const loopRandomNumber = await generateRandomNumber(cwd);
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

			// Snapshot C7: captura antes do develop para detectar alterações materiais
			const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
			const snapshotBefore = await takeSnapshot(extensionRoot);

			// C4 fix: Track stage start incrementally before execution
			loopEntry.stages.develop.startedAt = new Date().toISOString();

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
				statusMessage: `Loop ${loopNumber}/${loops}: desenvolvendo RESPONSE.md`,
			});
			await writeMarkdownFile(workspace.rootFiles.response, developResult.text);
			await writeMarkdownFile(path.join(loopDir, "RESPONSE.md"), developResult.text);

			// Snapshot C7: compara antes/depois e armazena diff no loopEntry
			const snapshotAfter = await takeSnapshot(extensionRoot);
			const c7Diff: SnapshotDiff = diffSnapshots(snapshotBefore, snapshotAfter);
			loopEntry.c7Snapshot = {
				hasChanges: c7Diff.hasChanges,
				diffSummary: formatSnapshotDiff(c7Diff),
				changedFiles: c7Diff.changed.length + c7Diff.added.length,
			};

			// C4 fix: Track stage completion incrementally after execution
			loopEntry.stages.develop.completedAt = new Date().toISOString();

			// Se C7=0 (sem alterações materiais), emite notificação WARNING
			if (!c7Diff.hasChanges) {
				const warningMsg = `⚠ Loop ${loopNumber}/${loops}: C7=0 — nenhuma alteração material no código fonte após develop. Isso indica pseudo-execução.`;
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

			// C4 fix: Track stage start incrementally before execution
			loopEntry.stages.evaluate.startedAt = new Date().toISOString();

			const evaluateResult = await runManagedStage({
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
				systemPrompt: EVALUATION_SYSTEM_PROMPT,
				userPrompt: buildEvaluationUserPrompt({
					cwd,
					workspace,
					loopNumber,
					requestedLoops: loops,
				}),
				manifest,
				manifestPath: workspace.rootFiles.manifest,
				onStatus,
				onEvent,
				statusMessage: `Loop ${loopNumber}/${loops}: avaliando FEEDBACK.md`,
			});
			await writeMarkdownFile(workspace.rootFiles.feedback, evaluateResult.text);
			await writeMarkdownFile(path.join(loopDir, "FEEDBACK.md"), evaluateResult.text);

			// C4 fix: Track stage completion incrementally after execution
			loopEntry.stages.evaluate.completedAt = new Date().toISOString();
			loopEntry.score = extractOverallScore(evaluateResult.text);
			if (typeof loopEntry.score === "number") latestScore = loopEntry.score;

			// C4 fix: Track stage start incrementally before execution
			loopEntry.stages.learning.startedAt = new Date().toISOString();

			const learningResult = await runManagedStage({
				cwd,
				protectedRoots: [workspace.callDir],
				modelPattern,
				thinkingLevel,
				record: loopEntry.stages.learning,
				stageName: "learning",
				loopNumber,
				requestedLoops: loops,
				completedLoops: manifest.completedLoops,
				relativeCallDir,
				systemPrompt: LEARNING_UPDATE_SYSTEM_PROMPT,
				userPrompt: buildLearningUpdateUserPrompt({
					cwd,
					workspace,
					loopNumber,
					requestedLoops: loops,
				}),
				manifest,
				manifestPath: workspace.rootFiles.manifest,
				onStatus,
				onEvent,
				statusMessage: `Loop ${loopNumber}/${loops}: atualizando LEARNING.md`,
			});
			const learningSections = extractMarkedSections(learningResult.text, ["LEARNING.md", "BACKLOG.md"]);
			await writeMarkdownFile(workspace.rootFiles.learning, learningSections["LEARNING.md"]);
			await writeMarkdownFile(workspace.rootFiles.backlog, learningSections["BACKLOG.md"]);
			await writeMarkdownFile(path.join(loopDir, "LEARNING.md"), learningSections["LEARNING.md"]);
			await writeMarkdownFile(path.join(loopDir, "BACKLOG.md"), learningSections["BACKLOG.md"]);

			// C4 fix: Track last stage completion and finalize loop entry incrementally
			loopEntry.stages.learning.completedAt = new Date().toISOString();
			loopEntry.completedAt = new Date().toISOString();
			manifest.completedLoops = loopNumber;
			await saveManifest(workspace.rootFiles.manifest, manifest);
			emitWorkflowEvent(onEvent, {
				type: "loop_completed",
				relativeCallDir,
				requestedLoops: loops,
				completedLoops: manifest.completedLoops,
				message: `Loop ${loopNumber}/${loops} concluído${typeof loopEntry.score === "number" ? ` • score ${loopEntry.score}/100` : ""}`,
				loopNumber,
				score: loopEntry.score,
			});
		}

		// === Final consolidation stages: REPORT.md and CHECKLIST.md ===
		// After all loops, generate the two final artifacts that consolidate the entire investigation.

		const reportRecord = createStageRecord(
			"report",
			toProjectRelativePath(cwd, `${workspace.logsDir}/report.jsonl`),
			toProjectRelativePath(cwd, `${workspace.logsDir}/report.stderr.log`),
		);

		const reportResult = await runManagedStage({
			cwd,
			protectedRoots: [workspace.callDir],
			modelPattern,
			thinkingLevel,
			record: reportRecord,
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
			statusMessage: `Consolidando relatório final: REPORT.md`,
		});
		await writeMarkdownFile(workspace.rootFiles.report, reportResult.text);

		const checklistRecord = createStageRecord(
			"checklist",
			toProjectRelativePath(cwd, `${workspace.logsDir}/checklist.jsonl`),
			toProjectRelativePath(cwd, `${workspace.logsDir}/checklist.stderr.log`),
		);

		const checklistResult = await runManagedStage({
			cwd,
			protectedRoots: [workspace.callDir],
			modelPattern,
			thinkingLevel,
			record: checklistRecord,
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
			statusMessage: `Gerando checklist de ações: CHECKLIST.md`,
		});
		await writeMarkdownFile(workspace.rootFiles.checklist, checklistResult.text);

		// O4 fix: workflow_completed emitted AFTER report and checklist stages complete
		manifest.status = "success";
		manifest.completedAt = new Date().toISOString();
		await saveManifest(workspace.rootFiles.manifest, manifest);
		onStatus?.(`Workflow concluído em ${relativeCallDir}`);
		emitWorkflowEvent(onEvent, {
			type: "workflow_completed",
			relativeCallDir,
			requestedLoops: loops,
			completedLoops: manifest.completedLoops,
			message: `Workflow concluído em ${relativeCallDir}`,
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
		onStatus?.(`Falha no workflow: ${manifest.lastError}`);
		emitWorkflowEvent(onEvent, {
			type: "workflow_failed",
			relativeCallDir,
			requestedLoops: loops,
			completedLoops: manifest.completedLoops,
			message: `Falha no workflow: ${manifest.lastError}`,
			isError: true,
		});
		throw error;
	}
}
