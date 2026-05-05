import assert from "node:assert/strict";
import { generateRandomNumber } from "../../lib/number-generator.ts";

export async function run(): Promise<void> {
	// B25: Expanded number-generator test coverage

	// Test 1: Bounds — every output must be between 1 and 100 inclusive
	const results = new Set<number>();
	for (let i = 0; i < 100; i++) {
		const num = generateRandomNumber();
		assert.ok(Number.isInteger(num), `Expected integer, got ${num}`);
		assert.ok(num >= 1 && num <= 100, `Expected 1-100, got ${num}`);
		results.add(num);
	}
	// With 100 samples, we expect some variation (probability of all equal is astronomically low)
	assert.ok(results.size > 1, "generateRandomNumber must produce variation");
	console.log("✓ generateRandomNumber generates integers between 1 and 100");

	// Test 2: Bounds stress — 1000 samples, all must be in range
	const N = 1000;
	const samples: number[] = [];
	for (let i = 0; i < N; i++) {
		const num = generateRandomNumber();
		assert.ok(num >= 1 && num <= 100, `Out of range at sample ${i}: ${num}`);
		samples.push(num);
	}

	// Test 3: Distribution — chi-squared test for uniformity
	// H0: numbers are uniformly distributed across 1-100
	// Expected frequency per bucket: N/100 = 10
	const buckets = new Array(100).fill(0);
	for (const s of samples) {
		buckets[s - 1]++;
	}
	const expected = N / 100;
	let chiSquared = 0;
	for (let i = 0; i < 100; i++) {
		const diff = buckets[i] - expected;
		chiSquared += (diff * diff) / expected;
	}
	// For 99 degrees of freedom, chi-squared critical value at p=0.001 is ~148.2
	// At p=0.01 it's ~135.8. We use a generous threshold.
	assert.ok(chiSquared < 150, `Chi-squared ${chiSquared.toFixed(2)} exceeds threshold; distribution may be non-uniform`);
	console.log(`✓ generateRandomNumber passes chi-squared uniformity test (χ²=${chiSquared.toFixed(2)}, df=99, N=${N})`);

	// Test 4: Coverage — with enough samples, we should see values across the full range
	const min = Math.min(...samples);
	const max = Math.max(...samples);
	assert.equal(min, 1, `Expected min=1, got ${min}`);
	assert.equal(max, 100, `Expected max=100, got ${max}`);
	console.log("✓ generateRandomNumber covers full range [1, 100]");

	// Test 5: Idempotency — calling multiple times produces independent results
	const a = generateRandomNumber();
	const b = generateRandomNumber();
	const c = generateRandomNumber();
	// Not asserting inequality (could collide), but asserting they are valid
	assert.ok(a >= 1 && a <= 100);
	assert.ok(b >= 1 && b <= 100);
	assert.ok(c >= 1 && c <= 100);
	console.log("✓ generateRandomNumber produces valid independent calls");
}
