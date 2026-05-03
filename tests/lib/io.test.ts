import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { normalizeMarkdown, writeMarkdownFile, writeJsonFile } from "../../lib/io.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

export async function run(): Promise<void> {
	// normalizeMarkdown
	assert.equal(normalizeMarkdown("hello\r\nworld"), "hello\nworld\n");
	assert.equal(normalizeMarkdown("  spaced  "), "spaced\n");
	assert.equal(normalizeMarkdown(""), "");
	assert.equal(normalizeMarkdown("\n\n\n"), "");
	assert.equal(normalizeMarkdown("content"), "content\n");
	console.log("✓ normalizeMarkdown normaliza corretamente");

	// writeMarkdownFile
	await withTempDir(async (dir) => {
		const filePath = path.join(dir, "test.md");
		await writeMarkdownFile(filePath, "hello world");
		const content = await fs.readFile(filePath, "utf8");
		assert.equal(content, "hello world\n");
	});
	console.log("✓ writeMarkdownFile persiste conteúdo normalizado");

	// writeMarkdownFile rejeita conteúdo vazio
	await withTempDir(async (dir) => {
		const filePath = path.join(dir, "empty.md");
		await assert.rejects(
			async () => await writeMarkdownFile(filePath, "   "),
			/Validation failed: content is empty/,
		);
	});
	console.log("✓ writeMarkdownFile rejeita conteúdo vazio");

	// writeJsonFile
	await withTempDir(async (dir) => {
		const filePath = path.join(dir, "data.json");
		await writeJsonFile(filePath, { key: "value", num: 42 });
		const content = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(content);
		assert.equal(parsed.key, "value");
		assert.equal(parsed.num, 42);
		assert.ok(content.endsWith("\n"));
	});
	console.log("✓ writeJsonFile persiste JSON formatado");
}
