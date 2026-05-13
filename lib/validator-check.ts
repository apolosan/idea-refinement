/**
 * Validator check: executes a final, non-blocking QA pass on the latest root RESPONSE.md
 * and stores the result next to that artifact as validator-check-output.md.
 *
 * This is intentionally asynchronous and does not gate workflow success (see docs/adr/0001-response-validator-role.md).
 *
 * Delegates to the unified validateResponse with strictness='full'.
 * When `manifestPath` and `cwd` are provided, the output path and score are also recorded on run.json for auditability.
 */

import { access, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { atomicWriteTextFile } from "./io.ts";
import { recordValidatorCheckOnManifest } from "./manifest.ts";
import { toProjectRelativePath } from "./path-utils.ts";
import { validateResponse } from "./response-validator.ts";

export async function runResponseValidatorCheck(
	responsePath: string,
	options: { manifestPath?: string; cwd?: string } = {},
): Promise<void> {
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

	const normalizedOutput = output.endsWith("\n") ? output : `${output}\n`;
	await atomicWriteTextFile(outputPath, normalizedOutput);

	if (options.manifestPath && options.cwd) {
		const relativeOutputPath = toProjectRelativePath(options.cwd, outputPath);
		await recordValidatorCheckOnManifest({
			manifestPath: options.manifestPath,
			validatorOutputRelativePath: relativeOutputPath,
			score,
		});
	}
}
