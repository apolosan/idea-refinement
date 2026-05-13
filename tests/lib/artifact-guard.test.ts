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
		const projectSource = path.join(dir, "src", "example.ts");
		const auditLogPath = path.join(protectedRoot, "logs", "guard-denials.jsonl");
		process.env.PI_IDEA_REFINEMENT_PROTECTED_ROOTS = JSON.stringify([protectedRoot]);
		mkdirSync(protectedRoot, { recursive: true });
		mkdirSync(path.dirname(historicalArtifact), { recursive: true });
		mkdirSync(path.dirname(projectSource), { recursive: true });
		writeFileSync(path.join(protectedRoot, "run.json"), JSON.stringify({ status: "running" }), "utf-8");
		writeFileSync(historicalArtifact, "# old report", "utf-8");
		writeFileSync(projectSource, "export const demo = true;\n", "utf-8");

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

		const readAllowed = await handler!(
			{ type: "tool_call", toolName: "read", input: { path: projectSource } },
			{ cwd: dir },
		);
		assert.equal(readAllowed, undefined);

		const readBlocked = await handler!(
			{ type: "tool_call", toolName: "read", input: { path: "/etc/passwd" } },
			{ cwd: dir },
		);
		assert.equal(readBlocked?.block, true);
		assert.match(readBlocked?.reason, /project scope/);
		console.log("✓ artifact-guard restricts read to the project scope");

		const bashAllowed = await handler!(
			{ type: "tool_call", toolName: "bash", input: { command: "ls docs/idea_refinement/artifacts_call_01" } },
			{ cwd: dir },
		);
		assert.equal(bashAllowed, undefined);

		const bashBlocked = await handler!(
			{ type: "tool_call", toolName: "bash", input: { command: "ls /tmp" } },
			{ cwd: dir },
		);
		assert.equal(bashBlocked?.block, true);
		assert.match(bashBlocked?.reason, /Absolute-path ls\/tree/);
		console.log("✓ artifact-guard restricts bash to active-call relative ls/tree paths");

		const outsideEdit = await handler!(
			{ type: "tool_call", toolName: "edit", input: { path: path.join(dir, "index.ts"), oldText: "a", newText: "b" } },
			{ cwd: dir },
		);
		assert.equal(outsideEdit?.block, true);
		assert.match(outsideEdit?.reason, /active-call artifacts/);
		console.log("✓ artifact-guard blocks edit outside the active protected workspace");

		const runningRootEdit = await handler!(
			{ type: "tool_call", toolName: "edit", input: { path: path.join(protectedRoot, "RESPONSE.md"), oldText: "a", newText: "b" } },
			{ cwd: dir },
		);
		assert.equal(runningRootEdit?.block, true);
		assert.match(runningRootEdit?.reason, /protected by the active idea-refinement workflow/);
		console.log("✓ artifact-guard blocks edit inside active protected root");

		const historicalEdit = await handler!(
			{ type: "tool_call", toolName: "edit", input: { path: historicalArtifact, oldText: "old", newText: "new" } },
			{ cwd: dir },
		);
		assert.equal(historicalEdit?.block, true);
		assert.match(historicalEdit?.reason, /active-call artifacts/);
		console.log("✓ artifact-guard blocks historical artifact edits outside the active root");

		const unknownTool = await handler!(
			{ type: "tool_call", toolName: "grep", input: { pattern: "x", path: dir } },
			{ cwd: dir },
		);
		assert.equal(unknownTool?.block, true);
		assert.match(unknownTool?.reason, /disabled/);
		console.log("✓ artifact-guard blocks tools outside the allowlist");

		const auditLog = await fs.readFile(auditLogPath, "utf-8");
		assert.match(auditLog, /"decision":"blocked"/);
		assert.match(auditLog, /"toolName":"write"/);
		assert.match(auditLog, /"toolName":"read"/);
		assert.match(auditLog, /"toolName":"edit"/);
		console.log("✓ artifact-guard persists denial audit records for blocked attempts");

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
