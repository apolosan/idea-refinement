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

function parseOverallScoreMatch(match: RegExpMatchArray | null): number | undefined {
	if (!match) return undefined;
	const score = Number.parseInt(match[1], 10);
	if (!Number.isInteger(score) || score < 1 || score > 100) return undefined;
	return score;
}

/**
 * Extracts the machine-readable overall score from FEEDBACK.md.
 * Tolerates common LLM formatting drift (markdown emphasis, light HTML, markdown tables).
 */
export function extractOverallScore(feedbackText: string): number | undefined {
	const normalized = feedbackText.replace(/\r\n/g, "\n");
	const htmlStripped = normalized.replace(/<[^>]{0,200}?>/gi, "");
	const defanged = htmlStripped.replace(/\*+/g, "").replace(/_+/g, "").replace(/`+/g, "");

	const patterns: RegExp[] = [
		/\bOverall score\s*:\s*(\d{1,3})\s*\/\s*100\b/i,
		/\|\s*Overall score\s*\|\s*(\d{1,3})\s*\/\s*100\b/i,
		/\bOverall score\s*=\s*(\d{1,3})\s*\/\s*100\b/i,
	];

	for (const textCandidate of [defanged, htmlStripped, normalized]) {
		for (const re of patterns) {
			const parsed = parseOverallScoreMatch(textCandidate.match(re));
			if (typeof parsed === "number") return parsed;
		}
	}
	return undefined;
}
