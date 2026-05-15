import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
	isPathInsideDirectory,
	isPathInsideDirectoryByRealPath,
	isPathInsideRoots,
	parseProtectedRoots,
} from "../../lib/path-guards.ts";

export async function run(): Promise<void> {
	assert.deepEqual(parseProtectedRoots(JSON.stringify(["/tmp/a", "/tmp/b"])), ["/tmp/a", "/tmp/b"]);
	assert.deepEqual(parseProtectedRoots("not-json"), []);
	assert.deepEqual(parseProtectedRoots(undefined), []);
	assert.deepEqual(parseProtectedRoots(JSON.stringify([1, "valid", null, "", "  "])), ["valid"]);
	assert.deepEqual(parseProtectedRoots(JSON.stringify("string-not-array")), []);
	console.log("✓ parseProtectedRoots parses and filters correctly");

	assert.equal(isPathInsideRoots("docs/idea_refinement/artifacts_call_01/LEARNING.md", "/repo", ["/repo/docs/idea_refinement"]), true);
	assert.equal(isPathInsideRoots("src/index.ts", "/repo", ["/repo/docs/idea_refinement"]), false);
	assert.equal(isPathInsideRoots("docs/idea_refinement", "/repo", ["/repo/docs/idea_refinement"]), true);
	assert.equal(isPathInsideRoots("docs/idea_refinement_extra", "/repo", ["/repo/docs/idea_refinement"]), false);
	assert.equal(isPathInsideDirectory("/repo/docs/idea_refinement", "/repo/docs/idea_refinement_extra"), false);
	console.log("✓ isPathInsideRoots protects only the artifacts directory");

	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-path-guards-"));
	const root = path.join(dir, "root");
	const outside = path.join(dir, "outside.txt");
	const linkInside = path.join(root, "inside-link.txt");
	try {
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(path.join(root, "normal.txt"), "inside\n", "utf-8");
		await fs.writeFile(outside, "outside\n", "utf-8");
		await fs.symlink(outside, linkInside);

		assert.equal(await isPathInsideDirectoryByRealPath(root, path.join(root, "normal.txt")), true);
		assert.equal(await isPathInsideDirectoryByRealPath(root, linkInside), false);
		console.log("✓ isPathInsideDirectoryByRealPath blocks symlink escapes");
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}
