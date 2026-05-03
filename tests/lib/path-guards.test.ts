import assert from "node:assert/strict";
import { parseProtectedRoots, isPathInsideRoots } from "../../lib/path-guards.ts";

export async function run(): Promise<void> {
	assert.deepEqual(parseProtectedRoots(JSON.stringify(["/tmp/a", "/tmp/b"])), ["/tmp/a", "/tmp/b"]);
	assert.deepEqual(parseProtectedRoots("not-json"), []);
	assert.deepEqual(parseProtectedRoots(undefined), []);
	assert.deepEqual(parseProtectedRoots(JSON.stringify([1, "valid", null, "", "  "])), ["valid"]);
	assert.deepEqual(parseProtectedRoots(JSON.stringify("string-not-array")), []);
	console.log("✓ parseProtectedRoots parseia e filtra corretamente");

	assert.equal(isPathInsideRoots("docs/idea_refinement/artifacts_call_01/LEARNING.md", "/repo", ["/repo/docs/idea_refinement"]), true);
	assert.equal(isPathInsideRoots("src/index.ts", "/repo", ["/repo/docs/idea_refinement"]), false);
	assert.equal(isPathInsideRoots("docs/idea_refinement", "/repo", ["/repo/docs/idea_refinement"]), true);
	assert.equal(isPathInsideRoots("docs/idea_refinement_extra", "/repo", ["/repo/docs/idea_refinement"]), false);
	console.log("✓ isPathInsideRoots protege apenas diretório de artefatos");
}
