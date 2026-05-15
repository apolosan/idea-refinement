import assert from "node:assert/strict";
import { assertValidLoopCount, LOOP_COUNT_HARD_LIMIT } from "../../lib/workflow-limits.ts";

export async function run(): Promise<void> {
	assert.doesNotThrow(() => assertValidLoopCount(1));
	assert.doesNotThrow(() => assertValidLoopCount(LOOP_COUNT_HARD_LIMIT));
	for (const invalid of [0, -1, LOOP_COUNT_HARD_LIMIT + 1, Number.NaN, 1.5, Number.MAX_SAFE_INTEGER]) {
		assert.throws(() => assertValidLoopCount(invalid), /between 1 and 1000/);
	}
	console.log("✓ assertValidLoopCount enforces workflow loop bounds");
}
