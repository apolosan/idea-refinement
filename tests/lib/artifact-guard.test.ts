import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import artifactGuardExtension from "../../artifact-guard.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function createMockPi() {
	const handlers: Array<{ event: string; handler: Function }> = [];
	return {
		on: (event: string, handler: Function) => {
			handlers.push({ event, handler });
		},
		handlers,
		getToolCallHandler() {
			return handlers.find((h) => h.event === "tool_call")?.handler;
		},
	};
}

export async function run(): Promise<void> {
	await withTempDir(async (dir) => {
		process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS = JSON.stringify([path.join(dir, "protected")]);
		const pi = createMockPi();
		artifactGuardExtension(pi as any);
		const handler = pi.getToolCallHandler();
		assert.ok(handler, "artifact guard deve registrar handler de tool_call");

		// write para caminho protegido durante workflow running
		mkdirSync(path.join(dir, "protected"), { recursive: true });
		writeFileSync(path.join(dir, "protected", "run.json"), JSON.stringify({ status: "running" }), "utf-8");
		const blockResult = await handler!(
			{ type: "tool_call", toolName: "write", input: { path: path.join(dir, "protected", "file.ts"), content: "x" } },
			{ cwd: dir },
		);
		assert.equal(blockResult?.block, true);
		assert.match(blockResult?.reason, /protected/);
		console.log("✓ artifact-guard bloqueia escrita durante workflow running");

		// write para caminho protegido quando workflow completed
		writeFileSync(path.join(dir, "protected", "run.json"), JSON.stringify({ status: "success" }), "utf-8");
		const allowResult = await handler!(
			{ type: "tool_call", toolName: "write", input: { path: path.join(dir, "protected", "file.ts"), content: "x" } },
			{ cwd: dir },
		);
		assert.equal(allowResult, undefined); // não bloqueia
		console.log("✓ artifact-guard permite escrita quando workflow concluído");

		// edit para caminho protegido durante workflow failed
		writeFileSync(path.join(dir, "protected", "run.json"), JSON.stringify({ status: "failed" }), "utf-8");
		const failedAllowResult = await handler!(
			{ type: "tool_call", toolName: "edit", input: { path: path.join(dir, "protected", "file.ts"), oldText: "a", newText: "b" } },
			{ cwd: dir },
		);
		assert.equal(failedAllowResult, undefined);
		console.log("✓ artifact-guard permite escrita quando workflow falhou");

		// caminho fora das roots protegidas
		const outsideResult = await handler!(
			{ type: "tool_call", toolName: "write", input: { path: path.join(dir, "outside", "file.ts"), content: "x" } },
			{ cwd: dir },
		);
		assert.equal(outsideResult, undefined);
		console.log("✓ artifact-guard não interfere em caminhos externos");

		// R1 fix: Test that terminal state of one root does NOT unlock another root
		const rootA = path.join(dir, "rootA");
		const rootB = path.join(dir, "rootB");
		mkdirSync(rootA, { recursive: true });
		mkdirSync(rootB, { recursive: true });
		writeFileSync(path.join(rootA, "run.json"), JSON.stringify({ status: "success" }), "utf-8");
		writeFileSync(path.join(rootB, "run.json"), JSON.stringify({ status: "running" }), "utf-8");
		process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS = JSON.stringify([rootA, rootB]);
		const pi3 = createMockPi();
		artifactGuardExtension(pi3 as any);
		const handler3 = pi3.getToolCallHandler();

		// RootA is terminal, so writes to rootA should be allowed
		const allowA = await handler3!(
			{ type: "tool_call", toolName: "write", input: { path: path.join(rootA, "file.ts"), content: "x" } },
			{ cwd: dir },
		);
		assert.equal(allowA, undefined);

		// RootB is still running, so writes to rootB should be blocked even though rootA is terminal
		const blockB = await handler3!(
			{ type: "tool_call", toolName: "write", input: { path: path.join(rootB, "file.ts"), content: "x" } },
			{ cwd: dir },
		);
		assert.equal(blockB?.block, true);
		console.log("✓ artifact-guard R1: terminal state de uma root não libera outra");

		// sem variável de ambiente
		delete process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS;
		const pi2 = createMockPi();
		artifactGuardExtension(pi2 as any);
		assert.equal(pi2.handlers.length, 0);
		console.log("✓ artifact-guard não registra handler quando não há roots protegidas");
	});
}
