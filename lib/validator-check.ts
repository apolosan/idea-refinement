/**
 * Validator check: executes validation on RESPONSE.md
 * and records results in experiments/results/ without blocking the workflow.
 *
 * Called asynchronously and non-critically after each loop.
 *
 * Uses unified validation constants from validation-constants.ts to avoid
 * duplication with response-validator.ts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

import {
	DECISION_TERMS,
	EPISTEMIC_TAGS,
	MIN_DECISION_COUNT,
	MIN_LINE_COUNT,
	MIN_TAG_COUNT,
	REQUIRED_SECTIONS,
} from "./validation-constants.ts";

interface Check {
	id: string;
	name: string;
	passed: boolean;
	detail: string;
}

function validateExtended(text: string): { checks: Check[]; score: number; maxScore: number } {
	const checks: Check[] = [];
	let score = 0;
	const maxScore = 85;

	const nonEmptyLines = text.split("\n").filter((l) => l.trim().length > 0).length;

	// C1: Minimum non-empty lines (unified constant: 50)
	const c1 = nonEmptyLines >= MIN_LINE_COUNT;
	checks.push({ id: "C1", name: "Minimum 50 non-empty lines", passed: c1, detail: `${nonEmptyLines} lines found` });
	if (c1) score += 10;

	// C2: Required sections (S4 fix: case-insensitive match)
	let missingSections = 0;
	for (const section of REQUIRED_SECTIONS) {
		if (!(text.includes(`## ${section}`) || text.includes(`## ${section.toLowerCase()}`))) missingSections += 1;
	}
	checks.push({ id: "C2", name: "All required sections present", passed: missingSections === 0, detail: `${REQUIRED_SECTIONS.length - missingSections}/${REQUIRED_SECTIONS.length}` });
	if (missingSections === 0) score += 15;
	else score += Math.max(0, 15 - missingSections * 3);

	// C3: At least 2 alternatives in matrix
	const altLines = text.split("\n").filter((l) => l.startsWith("|") && l.includes("|"));
	const hasAlt = altLines.length >= 4;
	checks.push({ id: "C3", name: "At least 2 alternatives in matrix", passed: hasAlt, detail: `${Math.floor((altLines.length - 2) / 2)} alternatives` });
	if (hasAlt) score += 15;

	// C4: Epistemic tags (unified constant: 3 minimum)
	let tagCount = 0;
	for (const tag of EPISTEMIC_TAGS) {
		tagCount += (text.match(new RegExp(tag.replace(/[\[\]]/g, "\\$&"), "g")) || []).length;
	}
	const hasTags = tagCount >= MIN_TAG_COUNT;
	checks.push({ id: "C4", name: "At least 3 epistemic tags", passed: hasTags, detail: `${tagCount} tags` });
	if (hasTags) score += 10;

	// C5: Decision terms (unified constant: 2 minimum)
	let decisionCount = 0;
	for (const term of DECISION_TERMS) if (text.includes(term)) decisionCount++;
	const hasDecisions = decisionCount >= MIN_DECISION_COUNT;
	checks.push({ id: "C5", name: "At least 2 decision terms", passed: hasDecisions, detail: `${decisionCount} terms` });
	if (hasDecisions) score += 10;

	// C6: [FACT] with file references
	const factCount = (text.match(/\[FACT\]/g) || []).length;
	const factRefs = text.match(/\[FACT\].*?[.:]\s*[^\s]+\.(ts|md|json)/g);
	const c6Passed = factCount === 0 || (factRefs !== null && factRefs.length >= Math.ceil(factCount * 0.5));
	checks.push({ id: "C6", name: "[FACT] with file reference (>50%)", passed: c6Passed, detail: `${factRefs?.length ?? 0}/${factCount} refs` });
	if (c6Passed) score += 10;

	// C7: Contains [RISK] or [INFERENCE]
	const hasRisk = text.includes("[RISK]");
	const hasInference = text.includes("[INFERENCE]");
	const c7Passed = hasRisk || hasInference;
	checks.push({ id: "C7", name: "Contains [RISK] or [INFERENCE]", passed: c7Passed, detail: hasRisk ? "[RISK] found" : hasInference ? "[INFERENCE] found" : "none" });
	if (c7Passed) score += 5;

	// C8: Before/after with numbers
	const hasMetricDelta = /\bbefore\b.*\bafter\b|\bafter\b.*\bbefore\b|\bbaseline\b|\bbefore\/after\b/i.test(text);
	const hasNumbers = /\d+%|\d+ms|\d+\/\d+|\d+ lines|score \d+/i.test(text);
	const c8 = hasMetricDelta && hasNumbers;
	checks.push({ id: "C8", name: "Before/after metrics with numbers", passed: c8, detail: `delta=${hasMetricDelta} numbers=${hasNumbers}` });
	if (c8) score += 10;

	return { checks, score, maxScore };
}

export async function runResponseValidatorCheck(responsePath: string): Promise<void> {
	if (!existsSync(responsePath)) return;

	const text = readFileSync(responsePath, "utf-8");
	const { checks, score, maxScore } = validateExtended(text);
	// C3 fix: Write output inside the callDir itself (sibling of RESPONSE.md)
	// and create directories recursively
	const outputPath = resolve(dirname(responsePath), "validator-check-output.md");
	mkdirSync(dirname(outputPath), { recursive: true });

	const output = [
		"# Validator Check (integrated, non-critical)",
		"",
		`- **RESPONSE.md**: ${responsePath}`,
		`- **Score**: ${score}/${maxScore}`,
		`- **Status**: ${score >= 50 ? "PASS" : "FAIL (≥50/85 to pass)"}`,
		"",
		"## Checks",
		"",
		"| Check | Name | Result | Detail |",
		"|-------|------|--------|--------|",
		...checks.map((c) => `| ${c.id} | ${c.name} | ${c.passed ? "✓" : "✗"} | ${c.detail} |`),
		"",
		"---",
		`*Generated at ${new Date().toISOString()} by validator-check.ts*`,
	].join("\n");

	writeFileSync(outputPath, output, "utf-8");
}
