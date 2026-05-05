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
	const activeTools: string[][] = [];
	return {
		on: (event: string, handler: Function) => {
			handlers.push({ event, handler });
		},
		setActiveTools: (toolNames: string[]) => {
			activeTools.push(toolNames);
		},
		handlers,
		activeTools,
		getToolCallHandler() {
			return handlers.find((h) => h.event === "tool_call")?.handler;
		},
		getSessionStartHandler() {
			return handlers.find((h) => h.event === "session_start")?.handler;
		},
	};
}

export async function run(): Promise<void> {
	await withTempDir(async (dir) => {
		const protectedRoot = path.join(dir, "docs", "idea_refinement", "artifacts_call_01");
		const historicalArtifact = path.join(dir, "docs", "idea_refinement", "artifacts_call_00", "REPORT.md");
		process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS = JSON.stringify([protectedRoot]);
		mkdirSync(protectedRoot, { recursive: true });
		mkdirSync(path.dirname(historicalArtifact), { recursive: true });
		writeFileSync(path.join(protectedRoot, "run.json"), JSON.stringify({ status: "running" }), "utf-8");
		writeFileSync(historicalArtifact, "# old report", "utf-8");

		const pi = createMockPi();
		artifactGuardExtension(pi as any);
		const handler = pi.getToolCallHandler();
		const onSessionStart = pi.getSessionStartHandler();
		assert.ok(handler, "artifact guard must register tool_call handler");
		assert.ok(onSessionStart, "artifact guard must register session_start handler");

		await onSessionStart!({}, { cwd: dir });
		assert.deepEqual(pi.activeTools[0], ["read", "bash", "edit"]);
		console.log("✓ artifact-guard constrains subprocess tools to read/bash/edit");

		const writeResult = await handler!(
			{ type: "tool_call", toolName: "write", input: { path: path.join(protectedRoot, "file.ts"), content: "x" } },
			{ cwd: dir },
		);
		assert.equal(writeResult?.block, true);
		assert.match(writeResult?.reason, /Direct write is disabled/);
		console.log("✓ artifact-guard blocks write for subprocess agents");

		const bashAllowed = await handler!(
			{ type: "tool_call", toolName: "bash", input: { command: "ls docs/idea_refinement" } },
			{ cwd: dir },
		);
		assert.equal(bashAllowed, undefined);

		const bashBlocked = await handler!(
			{ type: "tool_call", toolName: "bash", input: { command: "find . -type f" } },
			{ cwd: dir },
		);
		assert.equal(bashBlocked?.block, true);
		assert.match(bashBlocked?.reason, /ls or tree/);
		console.log("✓ artifact-guard restricts bash to ls/tree");

		const outsideEdit = await handler!(
			{ type: "tool_call", toolName: "edit", input: { path: path.join(dir, "index.ts"), oldText: "a", newText: "b" } },
			{ cwd: dir },
		);
		assert.equal(outsideEdit?.block, true);
		assert.match(outsideEdit?.reason, /restricted to idea-refinement artifacts/);
		console.log("✓ artifact-guard blocks edit outside docs/idea_refinement");

		const runningRootEdit = await handler!(
			{ type: "tool_call", toolName: "edit", input: { path: path.join(protectedRoot, "RESPONSE.md"), oldText: "a", newText: "b" } },
			{ cwd: dir },
		);
		assert.equal(runningRootEdit?.block, true);
		assert.match(runningRootEdit?.reason, /protected by the idea refinement workflow/);
		console.log("✓ artifact-guard blocks edit inside active protected root");

		const historicalEdit = await handler!(
			{ type: "tool_call", toolName: "edit", input: { path: historicalArtifact, oldText: "old", newText: "new" } },
			{ cwd: dir },
		);
		assert.equal(historicalEdit, undefined);
		console.log("✓ artifact-guard allows edit inside docs/idea_refinement outside protected root");

		const unknownTool = await handler!(
			{ type: "tool_call", toolName: "grep", input: { pattern: "x", path: dir } },
			{ cwd: dir },
		);
		assert.equal(unknownTool?.block, true);
		assert.match(unknownTool?.reason, /disabled/);
		console.log("✓ artifact-guard blocks tools outside the allowlist");

		delete process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS;
	});

	await withTempDir(async (dir) => {
		delete process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS;
		const pi = createMockPi();
		artifactGuardExtension(pi as any);
		assert.equal(pi.handlers.length, 0);
		console.log("✓ artifact-guard does not register handlers when there are no protected roots");
	});
}
