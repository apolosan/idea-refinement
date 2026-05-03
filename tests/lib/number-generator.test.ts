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
	// Com 100 amostras, esperamos alguma variação (probabilidade de todos iguais é astronomicamente baixa)
	assert.ok(results.size > 1, "generateRandomNumber deve produzir variação");
	console.log("✓ generateRandomNumber gera inteiros entre 1 e 100");
}
