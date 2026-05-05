/**
 * Validator check: executes validation on RESPONSE.md
 * and records results in experiments/results/ without blocking the workflow.
 *
 * Called asynchronously and non-critically after each loop.
 *
 * Delegates to the unified validateResponse with strictness='full'.
 */

import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { validateResponse } from "./response-validator.ts";

export async function runResponseValidatorCheck(responsePath: string): Promise<void> {
	try {
		await access(responsePath);
	} catch {
		return;
	}

	const text = await readFile(responsePath, "utf-8");
	const { checks, score, maxScore } = validateResponse(text, "full");

	const outputPath = resolve(dirname(responsePath), "validator-check-output.md");
	await mkdir(dirname(outputPath), { recursive: true });

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
		...checks.map((c) => `| ${c.name.split(":")[0]} | ${c.name.split(":").slice(1).join(":").trim()} | ${c.passed ? "✓" : "✗"} | ${c.detail} |`),
		"",
		"---",
		`*Generated at ${new Date().toISOString()} by validator-check.ts*`,
	].join("\n");

	await writeFile(outputPath, output, "utf-8");
}
