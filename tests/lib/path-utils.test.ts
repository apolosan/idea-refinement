import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
	allocateCallWorkspace,
	ensureLoopDirectory,
	findNextCallNumber,
	formatCallNumber,
	formatLoopNumber,
	getCallDirectoryName,
	getLoopDirectoryName,
	prepareCallWorkspace,
	toProjectRelativePath,
} from "../../lib/path-utils.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

export async function run(): Promise<void> {
	assert.equal(formatCallNumber(1), "01");
	assert.equal(formatCallNumber(12), "12");
	assert.equal(formatCallNumber(99), "99");
	assert.equal(formatCallNumber(100), "100");
	console.log("✓ formatCallNumber formats correctly");

	assert.equal(formatLoopNumber(1), "01");
	assert.equal(formatLoopNumber(5), "05");
	console.log("✓ formatLoopNumber formats correctly");

	assert.equal(getCallDirectoryName(1), "artifacts_call_01");
	assert.equal(getCallDirectoryName(12), "artifacts_call_12");
	console.log("✓ getCallDirectoryName generates correct names");

	assert.equal(getLoopDirectoryName(1), "loop_01");
	assert.equal(getLoopDirectoryName(3), "loop_03");
	console.log("✓ getLoopDirectoryName generates correct names");

	assert.equal(toProjectRelativePath("/repo", "/repo/docs/idea.md"), "docs/idea.md");
	assert.equal(toProjectRelativePath("/repo", "/repo"), ".");
	console.log("✓ toProjectRelativePath calculates relative paths");

	await withTempDir(async (dir) => {
		const baseDir = path.join(dir, "docs", "idea_refinement");
		await fs.mkdir(path.join(baseDir, "artifacts_call_01"), { recursive: true });
		await fs.mkdir(path.join(baseDir, "artifacts_call_03"), { recursive: true });
		assert.equal(await findNextCallNumber(baseDir), 4);
	});
	console.log("✓ findNextCallNumber increments correctly");

	await withTempDir(async (dir) => {
		assert.equal(await findNextCallNumber(path.join(dir, "nonexistent")), 1);
	});
	console.log("✓ findNextCallNumber returns 1 for nonexistent directory");

	await withTempDir(async (dir) => {
		const workspace = await prepareCallWorkspace(dir, 1);
		assert.equal(workspace.baseDir, path.join(dir, "docs", "idea_refinement"));
		assert.equal(workspace.callDir, path.join(dir, "docs", "idea_refinement", "artifacts_call_01"));
		await fs.access(workspace.logsDir);
		await fs.access(workspace.loopsDir);
		assert.ok(workspace.rootFiles.idea.endsWith("IDEA.md"));
		assert.ok(workspace.rootFiles.manifest.endsWith("run.json"));
		assert.ok(workspace.rootFiles.report.endsWith("REPORT.md"));
		assert.ok(workspace.rootFiles.checklist.endsWith("CHECKLIST.md"));
	});
	console.log("✓ prepareCallWorkspace creates complete structure");

	await withTempDir(async (dir) => {
		const workspace = await prepareCallWorkspace(dir, 1);
		const loopDir = await ensureLoopDirectory(workspace, 1);
		assert.equal(loopDir, path.join(workspace.loopsDir, "loop_01"));
		await fs.access(loopDir);
		await assert.rejects(fs.access(path.join(loopDir, "logs")));
	});
	console.log("✓ ensureLoopDirectory creates loop directory without extra logs subdirectory");

	await withTempDir(async (dir) => {
		const baseDir = path.join(dir, "docs", "idea_refinement");
		await fs.mkdir(path.join(baseDir, "artifacts_call_01"), { recursive: true });
		await fs.mkdir(path.join(baseDir, "artifacts_call_03"), { recursive: true });

		const { callNumber, workspace } = await allocateCallWorkspace(dir);
		assert.equal(callNumber, 2);
		assert.equal(path.basename(workspace.callDir), "artifacts_call_02");
		await fs.access(workspace.logsDir);
		await fs.access(workspace.loopsDir);
	});
	console.log("✓ allocateCallWorkspace fills collisions safely with exclusive directory creation");

	await withTempDir(async (dir) => {
		const baseDir = path.join(dir, "docs", "idea_refinement");
		await fs.mkdir(path.join(baseDir, "artifacts_call_01"), { recursive: true });

		const allocations = await Promise.all([
			allocateCallWorkspace(dir),
			allocateCallWorkspace(dir),
			allocateCallWorkspace(dir),
		]);
		const callNumbers = allocations.map((entry) => entry.callNumber).sort((a, b) => a - b);
		assert.deepEqual(callNumbers, [2, 3, 4]);
		assert.equal(new Set(allocations.map((entry) => entry.workspace.callDir)).size, 3);
	});
	console.log("✓ allocateCallWorkspace is collision-safe under concurrent allocation");

	await withTempDir(async (dir) => {
		const baseDir = path.join(dir, "docs", "idea_refinement");
		await fs.mkdir(path.join(baseDir, "artifacts_call_01"), { recursive: true });
		await fs.writeFile(path.join(baseDir, "artifacts_call_01", "orphan.txt"), "partial start", "utf8");

		const { callNumber, workspace } = await allocateCallWorkspace(dir);
		assert.equal(callNumber, 2);
		assert.equal(path.basename(workspace.callDir), "artifacts_call_02");
	});
	console.log("✓ allocateCallWorkspace skips partially-started call directories safely");
}
