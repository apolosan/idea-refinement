import assert from "node:assert/strict";
import { parsePositiveInteger, determineDirectivePolicy, extractOverallScore } from "../../lib/validation.ts";

export async function run(): Promise<void> {
	assert.equal(parsePositiveInteger("1"), 1);
	assert.equal(parsePositiveInteger("007"), 7);
	assert.equal(parsePositiveInteger("42"), 42);
	assert.equal(parsePositiveInteger("0"), undefined);
	assert.equal(parsePositiveInteger("-1"), undefined);
	assert.equal(parsePositiveInteger("3.2"), undefined);
	assert.equal(parsePositiveInteger("abc"), undefined);
	assert.equal(parsePositiveInteger(""), undefined);
	assert.equal(parsePositiveInteger("  5  "), 5);
	assert.equal(parsePositiveInteger("999999999999999999999"), undefined); // > MAX_SAFE_INTEGER
	console.log("✓ parsePositiveInteger valida inteiros positivos");

	assert.equal(determineDirectivePolicy(1), "OPTIMIZATION");
	assert.equal(determineDirectivePolicy(80), "OPTIMIZATION");
	assert.equal(determineDirectivePolicy(81), "CREATIVITY/EXPLORATION");
	assert.equal(determineDirectivePolicy(100), "CREATIVITY/EXPLORATION");
	assert.throws(() => determineDirectivePolicy(0), /Invalid random number/);
	assert.throws(() => determineDirectivePolicy(101), /Invalid random number/);
	assert.throws(() => determineDirectivePolicy(-5), /Invalid random number/);
	assert.throws(() => determineDirectivePolicy(3.5), /Invalid random number/);
	console.log("✓ determineDirectivePolicy aplica a regra Pareto corretamente");

	assert.equal(extractOverallScore("Overall score: 93/100"), 93);
	assert.equal(extractOverallScore("overall score: 7 / 100"), 7);
	assert.equal(extractOverallScore("sem score"), undefined);
	assert.equal(extractOverallScore("Overall score: 0/100"), undefined); // < 1
	assert.equal(extractOverallScore("Overall score: 101/100"), undefined); // > 100
	assert.equal(extractOverallScore("Overall score: 050/100"), 50); // leading zeros
	console.log("✓ extractOverallScore encontra o score total corretamente");
}
