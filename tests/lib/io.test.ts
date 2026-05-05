import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
	atomicWriteTextFile,
	copyTextFileAtomic,
	CRITICAL_WORKFLOW_LOOP_BASENAMES,
	CRITICAL_WORKFLOW_ROOT_BASENAMES,
	isCriticalWorkflowArtifactPath,
	normalizeMarkdown,
	writeMarkdownFile,
	writeJsonFile,
} from "../../lib/io.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

export async function run(): Promise<void> {
	assert.equal(normalizeMarkdown("hello\r\nworld"), "hello\nworld\n");
	assert.equal(normalizeMarkdown("  spaced  "), "spaced\n");
	assert.equal(normalizeMarkdown(""), "");
	assert.equal(normalizeMarkdown("\n\n\n"), "");
	assert.equal(normalizeMarkdown("content"), "content\n");
	console.log("✓ normalizeMarkdown normalizes correctly");

	await withTempDir(async (dir) => {
		const filePath = path.join(dir, "test.md");
		await writeMarkdownFile(filePath, "hello world");
		const content = await fs.readFile(filePath, "utf8");
		assert.equal(content, "hello world\n");
	});
	console.log("✓ writeMarkdownFile persists normalized content");

	await withTempDir(async (dir) => {
		const filePath = path.join(dir, "empty.md");
		await assert.rejects(
			async () => await writeMarkdownFile(filePath, "   "),
			/Validation failed: content is empty/,
		);
	});
	console.log("✓ writeMarkdownFile rejects empty content");

	await withTempDir(async (dir) => {
		const filePath = path.join(dir, "data.json");
		await writeJsonFile(filePath, { key: "value", num: 42 });
		const content = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(content);
		assert.equal(parsed.key, "value");
		assert.equal(parsed.num, 42);
		assert.ok(content.endsWith("\n"));
	});
	console.log("✓ writeJsonFile persists formatted JSON");

	assert.ok(CRITICAL_WORKFLOW_ROOT_BASENAMES.includes("run.json"));
	assert.ok(CRITICAL_WORKFLOW_ROOT_BASENAMES.includes("DIRECTIVE.md"));
	assert.ok(CRITICAL_WORKFLOW_ROOT_BASENAMES.includes("CHECKLIST.md"));
	assert.ok(CRITICAL_WORKFLOW_LOOP_BASENAMES.includes("RESPONSE.md"));
	assert.ok(CRITICAL_WORKFLOW_LOOP_BASENAMES.includes("BACKLOG.md"));
	assert.equal(
		isCriticalWorkflowArtifactPath("docs/idea_refinement/artifacts_call_03/run.json"),
		true,
	);
	assert.equal(
		isCriticalWorkflowArtifactPath("docs/idea_refinement/artifacts_call_03/DIRECTIVE.md"),
		true,
	);
	assert.equal(
		isCriticalWorkflowArtifactPath("docs/idea_refinement/artifacts_call_03/loops/loop_01/FEEDBACK.md"),
		true,
	);
	assert.equal(
		isCriticalWorkflowArtifactPath("docs/idea_refinement/artifacts_call_03/IDEA.md"),
		false,
	);
	assert.equal(
		isCriticalWorkflowArtifactPath("docs/idea_refinement/artifacts_call_03/bootstrap-raw-attempt-1.md"),
		false,
	);
	console.log("✓ critical-write denominator is explicit and path-matchable");

	await withTempDir(async (dir) => {
		const manifestPath = path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "run.json");
		await writeJsonFile(manifestPath, { version: 1, status: "old" });
		const tempPath = `${manifestPath}.tmp-test`;

		await assert.rejects(
			async () => {
				await atomicWriteTextFile(`${manifestPath}`, '{"version":2,"status":"new"}\n', {
					tempPath,
					beforeRename: () => {
						throw new Error("simulated interruption before rename");
					},
				});
			},
			/simulated interruption before rename/,
		);

		const content = await fs.readFile(manifestPath, "utf8");
		assert.equal(JSON.parse(content).status, "old");
		await assert.rejects(fs.access(tempPath));
	});
	console.log("✓ interrupted atomic write keeps run.json at old-or-new state, never partial");

	await withTempDir(async (dir) => {
		const directivePath = path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "DIRECTIVE.md");
		await writeMarkdownFile(directivePath, "old directive");
		const tempPath = `${directivePath}.tmp-test`;

		await assert.rejects(
			async () => {
				await atomicWriteTextFile(directivePath, "new directive\n", {
					tempPath,
					beforeRename: () => {
						throw new Error("simulated interruption before rename");
					},
				});
			},
			/simulated interruption before rename/,
		);

		const content = await fs.readFile(directivePath, "utf8");
		assert.equal(content, "old directive\n");
		await assert.rejects(fs.access(tempPath));
	});
	console.log("✓ interrupted atomic write keeps core markdown artifacts at old-or-new state, never partial");

	await withTempDir(async (dir) => {
		const sourcePath = path.join(dir, "source", "LEARNING.md");
		const targetPath = path.join(dir, "docs", "idea_refinement", "artifacts_call_02", "LEARNING.md");
		await fs.mkdir(path.dirname(sourcePath), { recursive: true });
		await fs.writeFile(sourcePath, "seeded learning\n", "utf8");
		assert.equal(await copyTextFileAtomic(sourcePath, targetPath), true);
		assert.equal(await fs.readFile(targetPath, "utf8"), "seeded learning\n");
		assert.equal(await copyTextFileAtomic(path.join(dir, "missing.md"), targetPath), false);
	});
	console.log("✓ copyTextFileAtomic seeds resume artifacts via the atomic helper");

	const workflowSource = await fs.readFile(path.resolve("lib/workflow.ts"), "utf8");
	const manifestSource = await fs.readFile(path.resolve("lib/manifest.ts"), "utf8");
	assert.ok(!/\.writeFile\(/.test(workflowSource), "lib/workflow.ts must not bypass the atomic helper with raw writeFile");
	assert.ok(!/\.writeFile\(/.test(manifestSource), "lib/manifest.ts must not bypass the atomic helper with raw writeFile");
	console.log("✓ critical workflow paths do not bypass the hardened persistence helper");
}
