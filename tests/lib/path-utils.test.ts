import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
	formatCallNumber,
	formatLoopNumber,
	getCallDirectoryName,
	getLoopDirectoryName,
	toProjectRelativePath,
	findNextCallNumber,
	prepareCallWorkspace,
	ensureLoopDirectory,
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
	console.log("✓ formatCallNumber formata corretamente");

	assert.equal(formatLoopNumber(1), "01");
	assert.equal(formatLoopNumber(5), "05");
	console.log("✓ formatLoopNumber formata corretamente");

	assert.equal(getCallDirectoryName(1), "artifacts_call_01");
	assert.equal(getCallDirectoryName(12), "artifacts_call_12");
	console.log("✓ getCallDirectoryName gera nomes corretos");

	assert.equal(getLoopDirectoryName(1), "loop_01");
	assert.equal(getLoopDirectoryName(3), "loop_03");
	console.log("✓ getLoopDirectoryName gera nomes corretos");

	assert.equal(toProjectRelativePath("/repo", "/repo/docs/idea.md"), "docs/idea.md");
	assert.equal(toProjectRelativePath("/repo", "/repo"), ".");
	console.log("✓ toProjectRelativePath calcula caminhos relativos");

	await withTempDir(async (dir) => {
		const baseDir = path.join(dir, "docs", "idea_refinement");
		await fs.mkdir(path.join(baseDir, "artifacts_call_01"), { recursive: true });
		await fs.mkdir(path.join(baseDir, "artifacts_call_03"), { recursive: true });
		assert.equal(await findNextCallNumber(baseDir), 4);
	});
	console.log("✓ findNextCallNumber incrementa corretamente");

	await withTempDir(async (dir) => {
		assert.equal(await findNextCallNumber(path.join(dir, "nonexistent")), 1);
	});
	console.log("✓ findNextCallNumber retorna 1 para diretório inexistente");

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
	console.log("✓ prepareCallWorkspace cria estrutura completa");

	await withTempDir(async (dir) => {
		const workspace = await prepareCallWorkspace(dir, 1);
		const loopDir = await ensureLoopDirectory(workspace, 1);
		assert.equal(loopDir, path.join(workspace.loopsDir, "loop_01"));
		await fs.access(loopDir);
		await fs.access(path.join(loopDir, "logs"));
	});
	console.log("✓ ensureLoopDirectory cria diretório do loop com logs");
}
