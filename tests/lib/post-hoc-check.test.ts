import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { takeSnapshot, diffSnapshots, formatSnapshotDiff } from "../../lib/post-hoc-check.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

export async function run(): Promise<void> {
	await withTempDir(async (dir) => {
		const dir1 = path.join(dir, "snap-test");
		await fs.mkdir(dir1, { recursive: true });
		await fs.writeFile(path.join(dir1, "a.ts"), "// original content a", "utf-8");
		await fs.writeFile(path.join(dir1, "b.ts"), "// original content b", "utf-8");

		const snap1 = await takeSnapshot(dir1);
		assert.equal(Object.keys(snap1).length, 2);
		assert.ok("a.ts" in snap1);
		assert.ok("b.ts" in snap1);

		await fs.writeFile(path.join(dir1, "a.ts"), "// modified content a", "utf-8");
		const snap2 = await takeSnapshot(dir1);
		const diff = diffSnapshots(snap1, snap2);
		assert.equal(diff.hasChanges, true);
		assert.equal(diff.changed.length, 1);
		assert.equal(diff.changed[0], "a.ts");
		assert.equal(diff.added.length, 0);
		assert.equal(diff.removed.length, 0);
	});
	console.log("✓ post-hoc-check detects changes between snapshots");

	await withTempDir(async (dir) => {
		const dir1 = path.join(dir, "snap-test");
		await fs.mkdir(dir1, { recursive: true });
		await fs.writeFile(path.join(dir1, "a.ts"), "// content", "utf-8");

		const snap1 = await takeSnapshot(dir1);
		await fs.writeFile(path.join(dir1, "c.ts"), "// new", "utf-8");
		await fs.unlink(path.join(dir1, "a.ts"));
		const snap2 = await takeSnapshot(dir1);
		const diff = diffSnapshots(snap1, snap2);
		assert.equal(diff.added.length, 1);
		assert.equal(diff.removed.length, 1);
		assert.equal(diff.changed.length, 0);
	});
	console.log("✓ post-hoc-check detects additions and removals");

	await withTempDir(async (dir) => {
		const nonexistentDir = path.join(dir, `does-not-exist-xyz-${Date.now()}`);
		const snap3 = await takeSnapshot(nonexistentDir);
		assert.deepEqual(snap3, {});
	});
	console.log("✓ post-hoc-check returns empty object for nonexistent directory");

	await withTempDir(async (dir) => {
		const root = path.join(dir, "artifact-snap");
		await fs.mkdir(path.join(root, "logs"), { recursive: true });
		await fs.writeFile(path.join(root, "RESPONSE.md"), "# Response", "utf-8");
		await fs.writeFile(path.join(root, "run.json"), "{}", "utf-8");
		await fs.writeFile(path.join(root, "logs", "ignored.md"), "ignored", "utf-8");
		const snap = await takeSnapshot(root, { fileExtensions: [".md"], ignoreDirs: ["logs"] });
		assert.deepEqual(Object.keys(snap), ["RESPONSE.md"]);
	});
	console.log("✓ post-hoc-check honors fileExtensions and ignoreDirs");

	// formatSnapshotDiff
	const emptyDiff = { changed: [], added: [], removed: [], hasChanges: false };
	assert.match(formatSnapshotDiff(emptyDiff), /No material changes/);

	const mixedDiff = { changed: ["a.ts"], added: ["b.ts"], removed: ["c.ts"], hasChanges: true };
	const formatted = formatSnapshotDiff(mixedDiff);
	assert.match(formatted, /changed \(1\): a\.ts/);
	assert.match(formatted, /added \(1\): b\.ts/);
	assert.match(formatted, /removed \(1\): c\.ts/);
	console.log("✓ formatSnapshotDiff formats correctly");
}
