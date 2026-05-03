/**
 * B1: Response Validator
 *
 * Validates RESPONSE.md structure and content quality after generation.
 * Enforces minimum criteria to prevent metatext/planning-only patterns.
 *
 * Uses unified validation constants from validation-constants.ts to avoid
 * duplication with validator-check.ts.
 */

import {
	DECISION_TERMS,
	EPISTEMIC_TAGS,
	MIN_DECISION_COUNT,
	MIN_FACT_COUNT,
	MIN_LINE_COUNT,
	MIN_TAG_COUNT,
	REQUIRED_SECTIONS,
} from "./validation-constants.ts";

export interface ValidationResult {
	passed: boolean;
	score: number; // 0-100
	checks: ValidationCheck[];
}

interface ValidationCheck {
	name: string;
	passed: boolean;
	detail?: string;
}

export function validateResponse(text: string): ValidationResult {
	const checks: ValidationCheck[] = [];
	let points = 0;
	const maxPoints = 100;

	// C1: Minimum line count (unified constant: 50 lines)
	const lines = text.split("\n").filter((l) => l.trim().length > 0).length;
	const c1 = lines >= MIN_LINE_COUNT;
	checks.push({
		name: "C1: Minimum 50 non-empty lines",
		passed: c1,
		detail: `${lines} lines found`,
	});
	if (c1) points += 15;

	// C2: Required sections present
	let missingSections = 0;
	for (const section of REQUIRED_SECTIONS) {
		const found = text.includes(`## ${section}`) || text.includes(`## ${section.toLowerCase()}`);
		if (!found) missingSections += 1;
		checks.push({
			name: `C2: Section "${section}" present`,
			passed: found,
		});
	}
	const c2Score = Math.max(0, 20 - missingSections * 3);
	points += c2Score;

	// C3: At least 2 alternatives
	const altLines = text.split("\n").filter((l) => l.startsWith("|") && l.includes("|"));
	const hasAlternatives = altLines.length >= 4; // at least 2 rows + header + separator
	checks.push({
		name: "C3: At least 2 alternatives in matrix",
		passed: hasAlternatives,
		detail: hasAlternatives ? `${Math.floor((altLines.length - 2) / 2)} alternatives detected` : "No matrix rows found",
	});
	if (hasAlternatives) points += 15;

	// C4: Epistemic tags used (unified constant: 3 tags minimum)
	let tagCount = 0;
	for (const tag of EPISTEMIC_TAGS) {
		const count = (text.match(new RegExp(tag.replace(/[\[\]]/g, "\\$&"), "g")) || []).length;
		tagCount += count;
	}
	const hasTags = tagCount >= MIN_TAG_COUNT;
	checks.push({
		name: "C4: At least 3 epistemic tags used",
		passed: hasTags,
		detail: `${tagCount} tags found`,
	});
	if (hasTags) points += 15;

	// C5: Decision terms used (unified constants: Keep/Adjust/Discard/Test later)
	let decisionCount = 0;
	for (const term of DECISION_TERMS) {
		if (text.includes(term)) decisionCount += 1;
	}
	const hasDecisions = decisionCount >= MIN_DECISION_COUNT;
	checks.push({
		name: "C5: At least 2 decision terms used",
		passed: hasDecisions,
		detail: `${decisionCount} terms found`,
	});
	if (hasDecisions) points += 15;

	// C6: Evidence citations (FACT + file reference, unified constant: 2 minimum)
	const factWithRef = (text.match(/\[FACT\]/g) || []).length;
	const hasFactRefs = factWithRef >= MIN_FACT_COUNT;
	checks.push({
		name: "C6: At least 2 [FACT] citations",
		passed: hasFactRefs,
		detail: `${factWithRef} citations found`,
	});
	if (hasFactRefs) points += 10;

	// C7: Avoids "Adopt" (invalid term per LEARNING.md)
	const hasAdopt = /\b[Aa]dopt\b/.test(text);
	checks.push({
		name: "C7: Does NOT use 'Adopt'",
		passed: !hasAdopt,
		detail: hasAdopt ? "'Adopt' found" : "no invalid term",
	});
	if (!hasAdopt) points += 5;

	// C8: Metrics change described (before/after)
	const hasMetricDelta = /\bbefore\b.*\bafter\b|\bafter\b.*\bbefore\b|\bbaseline\b|\bbefore\/after\b/i.test(text);
	const hasNumbers = /\d+%|\d+ms|\d+\/\d+|\d+ lines|score \d+/i.test(text);
	const c8 = hasMetricDelta && hasNumbers;
	checks.push({
		name: "C8: Before/after metrics with numbers",
		passed: c8,
		detail: c8 ? "metrics delta found" : "no numeric before/after detected",
	});
	if (c8) points += 5;

	return {
		passed: points >= 60,
		score: Math.round(points),
		checks,
	};
}
