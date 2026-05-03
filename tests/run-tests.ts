import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { extractMarkedSections } from "../lib/marker-parser.ts";
import { findNextCallNumber, formatCallNumber, getCallDirectoryName, prepareCallWorkspace } from "../lib/path-utils.ts";
import { isPathInsideRoots, parseProtectedRoots } from "../lib/path-guards.ts";
import { buildPiArgs, runPiStage } from "../lib/runner.ts";
import {
	applyIdeaRefinementProgressEvent,
	buildIdeaRefinementStatusLine,
	buildIdeaRefinementWidgetLines,
	createIdeaRefinementMonitorState,
	shouldUseUnicode,
} from "../lib/ui-monitor.ts";
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
} from "../lib/prompts.ts";
import { takeSnapshot, diffSnapshots } from "../lib/post-hoc-check.ts";
import { determineDirectivePolicy, extractOverallScore, parsePositiveInteger } from "../lib/validation.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

async function waitForMatch(filePath: string, pattern: RegExp, timeoutMs = 2_000): Promise<string> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const content = await fs.readFile(filePath, "utf8");
			if (pattern.test(content)) return content;
		} catch {
			// Ignore while the file is still being created/populated.
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}

	return fs.readFile(filePath, "utf8");
}

function ok(name: string): void {
	console.log(`✓ ${name}`);
}

async function run(): Promise<void> {
	assert.equal(parsePositiveInteger("1"), 1);
	assert.equal(parsePositiveInteger("007"), 7);
	assert.equal(parsePositiveInteger("0"), undefined);
	assert.equal(parsePositiveInteger("-1"), undefined);
	assert.equal(parsePositiveInteger("3.2"), undefined);
	ok("parsePositiveInteger valida inteiros positivos");

	assert.equal(determineDirectivePolicy(1), "OPTIMIZATION");
	assert.equal(determineDirectivePolicy(80), "OPTIMIZATION");
	assert.equal(determineDirectivePolicy(81), "CREATIVITY/EXPLORATION");
	assert.equal(determineDirectivePolicy(100), "CREATIVITY/EXPLORATION");
	ok("determineDirectivePolicy aplica a regra Pareto corretamente");

	assert.equal(extractOverallScore("Overall score: 93/100"), 93);
	assert.equal(extractOverallScore("overall score: 7 / 100"), 7);
	assert.equal(extractOverallScore("sem score"), undefined);
	ok("extractOverallScore encontra o score total");

	assert.match(LEARNING_UPDATE_SYSTEM_PROMPT, /prefira consolidar a expandir/i);
	assert.match(LEARNING_UPDATE_SYSTEM_PROMPT, /memória operacional/i);
	assert.match(LEARNING_UPDATE_SYSTEM_PROMPT, /BACKLOG\.md/i);
	assert.match(
		buildLearningUpdateUserPrompt({
			cwd: "/repo",
			workspace: {
				callDir: "/repo/docs/idea_refinement/artifacts_call_01",
				logsDir: "/repo/docs/idea_refinement/artifacts_call_01/logs",
				loopsDir: "/repo/docs/idea_refinement/artifacts_call_01/loops",
				rootFiles: {
					idea: "/repo/docs/idea_refinement/artifacts_call_01/IDEA.md",
					directive: "/repo/docs/idea_refinement/artifacts_call_01/DIRECTIVE.md",
					learning: "/repo/docs/idea_refinement/artifacts_call_01/LEARNING.md",
					criteria: "/repo/docs/idea_refinement/artifacts_call_01/CRITERIA.md",
					diagnosis: "/repo/docs/idea_refinement/artifacts_call_01/DIAGNOSIS.md",
					metrics: "/repo/docs/idea_refinement/artifacts_call_01/METRICS.md",
					backlog: "/repo/docs/idea_refinement/artifacts_call_01/BACKLOG.md",
					response: "/repo/docs/idea_refinement/artifacts_call_01/RESPONSE.md",
					feedback: "/repo/docs/idea_refinement/artifacts_call_01/FEEDBACK.md",
					manifest: "/repo/docs/idea_refinement/artifacts_call_01/RUN.json",
				},
			},
			loopNumber: 2,
			requestedLoops: 5,
		}),
		/LEARNING\.md e BACKLOG\.md/i,
	);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /DIAGNOSIS\.md/i);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /METRICS\.md/i);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /BACKLOG\.md/i);
	assert.match(DEVELOPMENT_SYSTEM_PROMPT, /Matriz mínima de alternativas/i);
	assert.match(EVALUATION_SYSTEM_PROMPT, /manter, ajustar, descartar ou testar depois/i);
	ok("prompts reforçam diagnóstico, métricas, backlog e decisão");

	const parsedRoots = parseProtectedRoots(JSON.stringify(["/tmp/a", "/tmp/b"]));
	assert.deepEqual(parsedRoots, ["/tmp/a", "/tmp/b"]);
	assert.equal(parseProtectedRoots("not-json").length, 0);
	assert.equal(isPathInsideRoots("docs/idea_refinement/artifacts_call_01/LEARNING.md", "/repo", ["/repo/docs/idea_refinement"]), true);
	assert.equal(isPathInsideRoots("src/index.ts", "/repo", ["/repo/docs/idea_refinement"]), false);
	ok("path guards protegem apenas o diretório de artefatos");

	const sections = extractMarkedSections(
		`<<<BEGIN FILE: DIRECTIVE.md>>>\nalpha content\n<<<END FILE: DIRECTIVE.md>>>\n<<<BEGIN FILE: LEARNING.md>>>\nbeta content\n<<<END FILE: LEARNING.md>>>\n<<<BEGIN FILE: CRITERIA.md>>>\ngamma content\n<<<END FILE: CRITERIA.md>>>`,
		["DIRECTIVE.md", "LEARNING.md", "CRITERIA.md"],
	);
	assert.equal(sections["DIRECTIVE.md"], "alpha content");
	assert.equal(sections["LEARNING.md"], "beta content");
	assert.equal(sections["CRITERIA.md"], "gamma content");
	ok("extractMarkedSections separa os artefatos iniciais");

	await withTempDir(async (dir) => {
		const baseDir = path.join(dir, "docs", "idea_refinement");
		await fs.mkdir(path.join(baseDir, "artifacts_call_01"), { recursive: true });
		await fs.mkdir(path.join(baseDir, "artifacts_call_03"), { recursive: true });
		assert.equal(await findNextCallNumber(baseDir), 4);
		assert.equal(formatCallNumber(1), "01");
		assert.equal(getCallDirectoryName(12), "artifacts_call_12");

		const workspace = await prepareCallWorkspace(dir, 4);
		await fs.access(workspace.callDir);
		await fs.access(workspace.logsDir);
		await fs.access(workspace.loopsDir);
	});
	ok("path-utils cria workspaces e incrementa chamadas");

	const piArgs = buildPiArgs({
		tempPromptPath: "/tmp/idea-refinement-system-prompt.md",
		userPrompt: "Usuário final",
		model: "github-copilot/gpt-5.4",
		thinkingLevel: "high",
	});
	assert.deepEqual(piArgs.slice(0, 7), ["--mode", "json", "-p", "--no-session", "--no-extensions", "--extension", piArgs[6]]);
	assert.equal(piArgs[6].endsWith("artifact-guard.ts"), true);
	assert.equal(piArgs.includes("--append-system-prompt"), true);
	assert.equal(piArgs.includes("--model"), true);
	assert.equal(piArgs.includes("--thinking"), true);
	assert.equal(piArgs[piArgs.indexOf("--thinking") + 1], "high");
	assert.equal(piArgs.at(-1), "Usuário final");
	ok("runner constrói subprocesso pi sem extensões descobertas e preserva thinking");

	const monitorState = createIdeaRefinementMonitorState();
	applyIdeaRefinementProgressEvent(monitorState, {
		type: "workflow_started",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 0,
		message: "Workflow iniciado em docs/idea_refinement/artifacts_call_04",
	});
	applyIdeaRefinementProgressEvent(monitorState, {
		type: "stage_started",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 0,
		message: "Loop 1/3: desenvolvendo RESPONSE.md",
		stageName: "develop",
		stageStatus: "running",
		loopNumber: 1,
	});
	applyIdeaRefinementProgressEvent(monitorState, {
		type: "tool_start",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 0,
		message: "Ferramenta read iniciada",
		stageName: "develop",
		loopNumber: 1,
		toolName: "read",
		toolArgs: { path: "prompt.md" },
	});
	applyIdeaRefinementProgressEvent(monitorState, {
		type: "stage_completed",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 0,
		message: "desenvolvimento concluído no loop 1/3",
		stageName: "develop",
		stageStatus: "success",
		loopNumber: 1,
	});
	assert.match(buildIdeaRefinementStatusLine(monitorState) ?? "", /loop 1\/3/);
	const widgetText = buildIdeaRefinementWidgetLines(monitorState).join("\n");
	assert.match(widgetText, /\[ STAGES \]/i);
	assert.match(widgetText, /tool:/i);
	assert.match(widgetText, /loops:/i);
	assert.match(widgetText, /\[ IDEA REFINE MONITOR \]/i);
	assert.match(widgetText, /\[ PROGRESS \]/i);
	assert.match(widgetText, /\[ CURRENT \]/i);
	// P0-1: Score always visible in widget and status line
	// When no score is available, shows "--" placeholder regardless of workflow status
	const noScoreRunning = createIdeaRefinementMonitorState();
	noScoreRunning.workflowStatus = "running";
	const noScoreRunningWidget = buildIdeaRefinementWidgetLines(noScoreRunning);
	assert.match(noScoreRunningWidget.join("\n"), /score --\/100/);
	const noScoreRunningStatus = buildIdeaRefinementStatusLine(noScoreRunning);
	assert.match(noScoreRunningStatus ?? "", /score --\/100/);

	const noScoreSuccess = createIdeaRefinementMonitorState();
	noScoreSuccess.workflowStatus = "success";
	const noScoreSuccessWidget = buildIdeaRefinementWidgetLines(noScoreSuccess);
	assert.match(noScoreSuccessWidget.join("\n"), /score --\/100/);

	// When score is available, shows actual score regardless of workflow status
	const withScoreRunning = createIdeaRefinementMonitorState();
	withScoreRunning.workflowStatus = "running";
	applyIdeaRefinementProgressEvent(withScoreRunning, {
		type: "loop_completed",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 1,
		loopNumber: 1,
		score: 72,
		message: "Loop 1/3 concluído • score 72/100",
	});
	const withScoreRunningWidget = buildIdeaRefinementWidgetLines(withScoreRunning);
	assert.match(withScoreRunningWidget.join("\n"), /score 72\/100/);
	const withScoreRunningStatus = buildIdeaRefinementStatusLine(withScoreRunning);
	assert.match(withScoreRunningStatus ?? "", /score 72\/100/);

	const withScoreSuccess = createIdeaRefinementMonitorState();
	withScoreSuccess.workflowStatus = "success";
	applyIdeaRefinementProgressEvent(withScoreSuccess, {
		type: "workflow_completed",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 3,
		score: 85,
		message: "Workflow concluído",
	});
	const withScoreSuccessWidget = buildIdeaRefinementWidgetLines(withScoreSuccess);
	assert.match(withScoreSuccessWidget.join("\n"), /score 85\/100/);

	// P1-4: shouldUseUnicode detects Unicode vs ASCII terminals
	assert.equal(typeof shouldUseUnicode(), "boolean");
	// Default should be true (modern terminal)
	assert.equal(shouldUseUnicode(), true);

	// P0-1: Widget shows report and checklist in stages section
	assert.match(widgetText, /report/i);
	assert.match(widgetText, /checklist/i);

	ok("ui-monitor resume status do workflow de forma objetiva");

	await withTempDir(async (dir) => {
		const scriptPath = path.join(dir, "fake-pi-stage.js");
		const logPath = path.join(dir, "logs", "stage.jsonl");
		const stderrPath = path.join(dir, "logs", "stage.stderr.log");
		await fs.writeFile(
			scriptPath,
			[
				"const events = [",
				"  [0, { type: 'session' }],",
				"  [5, { type: 'message_update', assistantMessageEvent: { type: 'thinking_start' }, message: { role: 'assistant' } }],",
				"  [8, { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Raciocínio parcial do agente', partial: { role: 'assistant' } }, message: { role: 'assistant' } }],",
				"  [10, { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'prompt.md' } }],",
				"  [20, { type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read', result: { content: [{ type: 'text', text: 'ok' }] }, isError: false }],",
				"  [25, { type: 'message_update', assistantMessageEvent: { type: 'thinking_end' }, message: { role: 'assistant' } }],",
				"  [30, { type: 'message_update', assistantMessageEvent: { type: 'text_start' }, message: { role: 'assistant' } }],",
				"  [40, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', partial: 'x'.repeat(200000) }, message: { role: 'assistant' } }],",
				"  [60, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'OK final' }], model: 'fake-model', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0 } }, stopReason: 'stop' } }],",
				"];",
				"for (const [delay, event] of events) {",
				"  setTimeout(() => process.stdout.write(JSON.stringify(event) + '\\n'), delay);",
				"}",
				"setTimeout(() => process.stderr.write('stderr parcial\\n'), 15);",
				"setTimeout(() => process.exit(0), 90);",
			].join("\n"),
			"utf8",
		);

		const progressMessages: string[] = [];
		const streamEvents: string[] = [];
		const stagePromise = runPiStage({
			cwd: dir,
			systemPrompt: "system",
			userPrompt: "user",
			logPath,
			stderrPath,
			protectedRoots: [],
			onProgress: (message) => progressMessages.push(message),
			onEvent: (event) => streamEvents.push(event.type),
			invocation: {
				command: process.execPath,
				args: [scriptPath],
			},
		});

		const partialLog = await waitForMatch(logPath, /tool_execution_start/);
		assert.match(partialLog, /tool_execution_start/);

		const result = await stagePromise;
		const persistedLog = await fs.readFile(logPath, "utf8");
		assert.equal(result.text.trim(), "OK final");
		assert.equal(result.model, "fake-model");
		assert.equal(result.usage.turns, 1);
		assert.match(progressMessages.join("\n"), /Aguardando resposta do agente/);
		assert.match(progressMessages.join("\n"), /Executando ferramenta read/);
		assert.match(progressMessages.join("\n"), /Redigindo resposta/);
		assert.match(streamEvents.join("\n"), /tool_execution_start/);
		assert.match(persistedLog, /OK final/);
		assert.doesNotMatch(persistedLog, /Raciocínio parcial do agente/);
		assert.doesNotMatch(persistedLog, /x{1000}/);
		assert.match(await fs.readFile(stderrPath, "utf8"), /stderr parcial/);
	});
	ok("runPiStage transmite logs incrementalmente e reporta progresso");

	// P0-2: post-hoc-check unit tests
	await withTempDir(async (dir) => {
		// Test: detecta mudanças entre snapshots
		const dir1 = path.join(dir, "snap-test");
		await fs.mkdir(dir1, { recursive: true });
		await fs.writeFile(path.join(dir1, "a.ts"), "// original content a", "utf-8");
		await fs.writeFile(path.join(dir1, "b.ts"), "// original content b", "utf-8");

		const snap1 = await takeSnapshot(dir1);
		assert.equal(Object.keys(snap1).length, 2);
		assert.ok("a.ts" in snap1);
		assert.ok("b.ts" in snap1);

		// Modify a.ts
		await fs.writeFile(path.join(dir1, "a.ts"), "// modified content a", "utf-8");

		const snap2 = await takeSnapshot(dir1);
		const diff = diffSnapshots(snap1, snap2);
		assert.equal(diff.hasChanges, true);
		assert.equal(diff.changed.length, 1);
		assert.equal(diff.changed[0], "a.ts");
		assert.equal(diff.added.length, 0);
		assert.equal(diff.removed.length, 0);

		// Test: retorna objeto vazio para diretório inexistente
		const nonexistentDir = path.join(dir, `nao-existe-xyz-${Date.now()}`);
		const snap3 = await takeSnapshot(nonexistentDir);
		assert.deepEqual(snap3, {});
	});
	ok("post-hoc-check detecta mudanças entre snapshots e lida com dirs inexistentes");

	// P0-2: Verify shouldUseUnicode returns false for dumb terminal
	const origTerm = process.env.TERM;
	process.env.TERM = "dumb";
	assert.equal(shouldUseUnicode(), false);
	process.env.TERM = origTerm ?? "";
	ok("shouldUseUnicode detecta terminal dumb corretamente");

	// P0-2: Verify ASCII fallback in widget
	const asciiState = createIdeaRefinementMonitorState();
	asciiState.workflowStatus = "running";
	const origTerm2 = process.env.TERM;
	process.env.TERM = "dumb";
	const asciiLines = buildIdeaRefinementWidgetLines(asciiState);
	const asciiText = asciiLines.join("\n");
	assert.doesNotMatch(asciiText, /✓/);  // no unicode check marks
	assert.doesNotMatch(asciiText, /✗/);  // no unicode x marks
	assert.match(asciiText, /status:/i);   // still has content
	process.env.TERM = origTerm2 ?? "";
	ok("widget usa caracteres ASCII em terminal limitado");

	// Verify REPORT and CHECKLIST system prompts and user prompts exist
	assert.match(REPORT_SYSTEM_PROMPT, /Relatório de Investigação/i);
	assert.match(CHECKLIST_SYSTEM_PROMPT, /Checklist de Ações/i);
	assert.match(REPORT_SYSTEM_PROMPT, /etiqueta epistêmica/i);
	assert.match(CHECKLIST_SYSTEM_PROMPT, /acionável/i);
	ok("prompts REPORT.md e CHECKLIST.md estão definidos");

	// Verify report and checklist user prompts build correctly
	const mockWorkspace = {
		baseDir: "/test",
		callDir: "/test/docs/idea_refinement/artifacts_call_01",
		logsDir: "/test/docs/idea_refinement/artifacts_call_01/logs",
		loopsDir: "/test/docs/idea_refinement/artifacts_call_01/loops",
		rootFiles: {
			idea: "/test/docs/idea_refinement/artifacts_call_01/IDEA.md",
			directive: "/test/docs/idea_refinement/artifacts_call_01/DIRECTIVE.md",
			learning: "/test/docs/idea_refinement/artifacts_call_01/LEARNING.md",
			criteria: "/test/docs/idea_refinement/artifacts_call_01/CRITERIA.md",
			diagnosis: "/test/docs/idea_refinement/artifacts_call_01/DIAGNOSIS.md",
			metrics: "/test/docs/idea_refinement/artifacts_call_01/METRICS.md",
			backlog: "/test/docs/idea_refinement/artifacts_call_01/BACKLOG.md",
			response: "/test/docs/idea_refinement/artifacts_call_01/RESPONSE.md",
			feedback: "/test/docs/idea_refinement/artifacts_call_01/FEEDBACK.md",
			manifest: "/test/docs/idea_refinement/artifacts_call_01/RUN.json",
			report: "/test/docs/idea_refinement/artifacts_call_01/REPORT.md",
			checklist: "/test/docs/idea_refinement/artifacts_call_01/CHECKLIST.md",
		},
	};
	const reportPrompt = buildReportUserPrompt({ cwd: "/test", workspace: mockWorkspace, requestedLoops: 5, completedLoops: 5 });
	assert.match(reportPrompt, /REPORT\.md/i);
	assert.match(reportPrompt, /5\/5/);

	const checklistPrompt = buildChecklistUserPrompt({ cwd: "/test", workspace: mockWorkspace, requestedLoops: 5, completedLoops: 5 });
	assert.match(checklistPrompt, /CHECKLIST\.md/i);
	assert.match(checklistPrompt, /5\/5/);
	ok("user prompts REPORT.md e CHECKLIST.md constroem corretamente");

	await import("../index.ts");
	ok("smoke import da extensão principal");

	console.log("\nTodos os testes passaram.");
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
