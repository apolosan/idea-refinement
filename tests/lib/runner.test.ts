import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
	buildPiArgs,
	runPiStage,
} from "../../lib/runner.ts";

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
			// Ignore while file is being created.
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return fs.readFile(filePath, "utf8");
}

export async function run(): Promise<void> {
	const piArgs = buildPiArgs({
		tempPromptPath: "/tmp/idea-refinement-system-prompt.md",
		userPrompt: "Usuário final",
		model: "github-copilot/gpt-5.4",
		thinkingLevel: "high",
		cwd: "/repo",
	});
	assert.deepEqual(piArgs.slice(0, 7), ["--mode", "json", "-p", "--no-session", "--no-extensions", "--extension", piArgs[6]]);
	assert.ok(piArgs[6].endsWith("artifact-guard.ts") || piArgs[6].includes("artifact-guard"));
	assert.ok(piArgs.includes("--append-system-prompt"));
	assert.ok(piArgs.includes("--model"));
	assert.ok(piArgs.includes("--thinking"));
	assert.equal(piArgs[piArgs.indexOf("--thinking") + 1], "high");
	// userPrompt is appended after all flags
	assert.equal(piArgs.indexOf("Usuário final"), piArgs.length - 1);
	console.log("✓ buildPiArgs constrói argumentos corretamente");

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
	console.log("✓ runPiStage transmite logs incrementalmente e reporta progresso");
}
