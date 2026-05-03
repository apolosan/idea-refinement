import type { DirectivePolicy } from "./types.ts";

export function parsePositiveInteger(input: string): number | undefined {
	const trimmed = input.trim();
	if (!/^\d+$/.test(trimmed)) return undefined;
	const value = Number.parseInt(trimmed, 10);
	if (!Number.isSafeInteger(value) || value <= 0) return undefined;
	return value;
}

export function determineDirectivePolicy(randomNumber: number): DirectivePolicy {
	if (!Number.isInteger(randomNumber) || randomNumber < 1 || randomNumber > 100) {
		throw new Error(`Invalid random number for directive policy: ${randomNumber}`);
	}

	return randomNumber <= 80 ? "OPTIMIZATION" : "CREATIVITY/EXPLORATION";
}

export function extractOverallScore(feedbackText: string): number | undefined {
	const match = feedbackText.match(/Overall score:\s*(\d{1,3})\s*\/\s*100/i);
	if (!match) return undefined;
	const score = Number.parseInt(match[1], 10);
	if (!Number.isInteger(score) || score < 1 || score > 100) return undefined;
	return score;
}
