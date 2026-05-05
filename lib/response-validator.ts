/**
 * B1: Response Validator
 *
 * Validates RESPONSE.md structure and content quality after generation.
 * Enforces minimum criteria to prevent metatext/planning-only patterns.
 *
 * Uses unified validation constants from validation-constants.ts.
 * Supports two strictness levels:
 *   - 'fast'  : 100-point scale, threshold 60 (used inside the workflow loop).
 *   - 'full'  : 85-point scale, threshold 50 (used for post-hoc checks).
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
	score: number;
	maxScore: number;
	checks: ValidationCheck[];
}

interface ValidationCheck {
	name: string;
	passed: boolean;
	detail?: string;
}

function getSectionLines(text: string, sectionName: string): string[] {
	const lines = text.split("\n");
	const targetHeading = sectionName.trim().toLowerCase();
	let startIndex = -1;

	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = lines[index].trim().toLowerCase();
		if (trimmed === `## ${targetHeading}`) {
			startIndex = index + 1;
			break;
		}
	}

	if (startIndex === -1) return [];

	const sectionLines: string[] = [];
	for (let index = startIndex; index < lines.length; index += 1) {
		const trimmed = lines[index].trim();
		if (/^##\s+/.test(trimmed)) break;
		sectionLines.push(lines[index]);
	}
	return sectionLines;
}

function countMatrixRows(lines: string[]): number {
	return lines.filter((line) => {
		const trimmed = line.trim();
		return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 1;
	}).length;
}

export function validateResponse(text: string, strictness: "fast" | "full" = "fast"): ValidationResult {
	const checks: ValidationCheck[] = [];
	let points = 0;
	const maxPoints = strictness === "fast" ? 100 : 85;
	const threshold = strictness === "fast" ? 60 : 50;

	// C1: Minimum line count
	const lines = text.split("\n").filter((l) => l.trim().length > 0).length;
	const c1 = lines >= MIN_LINE_COUNT;
	checks.push({
		name: `C1: Minimum ${MIN_LINE_COUNT} non-empty lines`,
		passed: c1,
		detail: `${lines} lines found`,
	});
	if (c1) points += strictness === "fast" ? 15 : 10;

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
	if (strictness === "fast") {
		const c2Score = Math.max(0, 20 - missingSections * 3);
		points += c2Score;
	} else {
		if (missingSections === 0) points += 15;
		else points += Math.max(0, 15 - missingSections * 3);
	}

	// C3: At least 2 alternatives inside the dedicated matrix section
	const matrixSectionLines = getSectionLines(text, "Minimum alternatives matrix");
	const matrixRowCount = countMatrixRows(matrixSectionLines);
	const hasAlternatives = matrixRowCount >= 4; // header + separator + at least 2 alternatives
	checks.push({
		name: "C3: At least 2 alternatives in matrix",
		passed: hasAlternatives,
		detail: matrixSectionLines.length === 0
			? "No valid '## Minimum alternatives matrix' section found"
			: hasAlternatives
				? `${Math.max(0, matrixRowCount - 2)} alternatives detected inside target section`
				: "Not enough matrix rows inside target section",
	});
	if (hasAlternatives) points += 15;

	// C4: Epistemic tags used
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
	if (hasTags) points += strictness === "fast" ? 15 : 10;

	// C5: Decision terms used
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
	if (hasDecisions) points += strictness === "fast" ? 15 : 10;

	// C6: Evidence citations
	const factWithRef = (text.match(/\[FACT\]/g) || []).length;
	if (strictness === "fast") {
		const hasFactRefs = factWithRef >= MIN_FACT_COUNT;
		checks.push({
			name: "C6: At least 2 [FACT] citations",
			passed: hasFactRefs,
			detail: `${factWithRef} citations found`,
		});
		if (hasFactRefs) points += 10;
	} else {
		const factRefs = text.match(/\[FACT\].*?[.:]\s*[^\s]+\.(ts|md|json)/g);
		const c6Passed = factWithRef === 0 || (factRefs !== null && factRefs.length >= Math.ceil(factWithRef * 0.5));
		checks.push({
			name: "C6: [FACT] with file reference (>50%)",
			passed: c6Passed,
			detail: `${factRefs?.length ?? 0}/${factWithRef} refs`,
		});
		if (c6Passed) points += 10;
	}

	// C7: fast mode checks "Adopt"; full mode checks [RISK] or [INFERENCE]
	if (strictness === "fast") {
		const hasAdopt = /\b[Aa]dopt\b/.test(text);
		checks.push({
			name: "C7: Does NOT use 'Adopt'",
			passed: !hasAdopt,
			detail: hasAdopt ? "'Adopt' found" : "no invalid term",
		});
		if (!hasAdopt) points += 5;
	} else {
		const hasRisk = text.includes("[RISK]");
		const hasInference = text.includes("[INFERENCE]");
		const c7Passed = hasRisk || hasInference;
		checks.push({
			name: "C7: Contains [RISK] or [INFERENCE]",
			passed: c7Passed,
			detail: hasRisk ? "[RISK] found" : hasInference ? "[INFERENCE] found" : "none",
		});
		if (c7Passed) points += 5;
	}

	// C8: Metrics change described (before/after)
	const hasMetricDelta = /\bbefore\b.*\bafter\b|\bafter\b.*\bbefore\b|\bbaseline\b|\bbefore\/after\b/i.test(text);
	const hasNumbers = /\d+%|\d+ms|\d+\/\d+|\d+ lines|score \d+/i.test(text);
	const c8 = hasMetricDelta && hasNumbers;
	checks.push({
		name: "C8: Before/after metrics with numbers",
		passed: c8,
		detail: c8 ? "metrics delta found" : "no numeric before/after detected",
	});
	if (c8) points += strictness === "fast" ? 5 : 10;

	return {
		passed: points >= threshold,
		score: Math.round(points),
		maxScore: maxPoints,
		checks,
	};
}
