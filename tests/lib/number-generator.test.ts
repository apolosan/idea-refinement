import assert from "node:assert/strict";
import { generateRandomNumber } from "../../lib/number-generator.ts";

export async function run(): Promise<void> {
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
}
