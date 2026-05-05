import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import { clearTerminalStateCache } from "../../lib/terminal-state-cache.ts";
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
		setActiveTools: (_toolNames: string[]) => {},
		handlers,
		getToolCallHandler() {
			return handlers.find((h) => h.event === "tool_call")?.handler;
		},
	};
}

async function expectProtectedEditBlocked(manifestContent: string | undefined, label: string): Promise<void> {
	await withTempDir(async (dir) => {
		clearTerminalStateCache();
		const protectedDir = path.join(dir, "docs", "idea_refinement", "artifacts_call_01");
		mkdirSync(protectedDir, { recursive: true });
		if (manifestContent !== undefined) {
			writeFileSync(path.join(protectedDir, "run.json"), manifestContent, "utf-8");
		}
		process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS = JSON.stringify([protectedDir]);
		const pi = createMockPi();
		artifactGuardExtension(pi as any);
		const handler = pi.getToolCallHandler()!;

		const result = await handler(
			{ type: "tool_call", toolName: "edit", input: { path: path.join(protectedDir, "file.md"), oldText: "x", newText: "y" } },
			{ cwd: dir },
		);
		assert.equal(result?.block, true, `${label} should block edits`);
		console.log(`✓ B38: ${label} blocks edits`);

		delete process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS;
		clearTerminalStateCache();
	});
}

export async function run(): Promise<void> {
	await expectProtectedEditBlocked("{}", "empty object {}");
	await expectProtectedEditBlocked("null", "null value");
	await expectProtectedEditBlocked(JSON.stringify({ schemaVersion: 1, cwd: "/repo" }), "missing status field");
	await expectProtectedEditBlocked(JSON.stringify({ status: 42 }), "status with wrong type");
	await expectProtectedEditBlocked("{invalid json!!!", "invalid JSON");
	await expectProtectedEditBlocked(undefined, "missing run.json");

	await withTempDir(async (dir) => {
		clearTerminalStateCache();
		const protectedDir = path.join(dir, "docs", "idea_refinement", "artifacts_call_01");
		mkdirSync(protectedDir, { recursive: true });
		writeFileSync(path.join(protectedDir, "run.json"), JSON.stringify({ status: "success" }), "utf-8");
		process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS = JSON.stringify([protectedDir]);
		const pi = createMockPi();
		artifactGuardExtension(pi as any);
		const handler = pi.getToolCallHandler()!;

		const result = await handler(
			{ type: "tool_call", toolName: "edit", input: { path: path.join(protectedDir, "file.md"), oldText: "x", newText: "y" } },
			{ cwd: dir },
		);
		assert.equal(result, undefined, "Valid success manifest should allow edits in terminal artifact roots");
		console.log("✓ B38: valid success manifest allows edit in terminal protected root");

		delete process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS;
		clearTerminalStateCache();
	});
}
