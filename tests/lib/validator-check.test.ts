import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { runResponseValidatorCheck } from "../../lib/validator-check.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

export async function run(): Promise<void> {
	await withTempDir(async (dir) => {
		const responsePath = path.join(dir, "RESPONSE.md");
		const text = [
			"# Response",
			"## Loop framing",
			"Content here with enough length to satisfy the minimum line count requirement for validation purposes.",
			"## Focused loop diagnosis",
			"[FACT] File reference: src/index.ts",
			"[FACT] Another fact: lib/utils.ts",
			"## Minimum alternatives matrix",
			"| Alt | Problem | Mechanism | Benefit | Cost | Risk |",
			"|-----|---------|-----------|---------|------|------|",
			"| A   | X       | Y         | Z       | Low  | None |",
			"| B   | X2      | Y2        | Z2      | High | Some |",
			"## Current state vs. proposed state",
			"before: baseline 50ms, after: target 30ms (40% improvement)",
			"## Iteration decision",
			"Keep the current approach and Adjust parameters.",
			"## Explicit discards of this iteration",
			"Discard alternative C due to excessive cost.",
			"## Next focuses",
			"Test later the integration with external module.",
			"[INFERENCE] Based on data.",
			"[RISK] Potential failure.",
		].join("\n");
		await fs.writeFile(responsePath, text, "utf-8");
		await runResponseValidatorCheck(responsePath);

		// C3 fix: output is now written in the same dir as RESPONSE.md
		const expectedPath = path.join(dir, "validator-check-output.md");
		assert.equal(existsSync(expectedPath), true);
		const output = readFileSync(expectedPath, "utf-8");
		assert.match(output, /Validator Check/);
		assert.match(output, /PASS/);
	});
	console.log("✓ runResponseValidatorCheck generates report for valid response");

	await withTempDir(async (dir) => {
		const missingPath = path.join(dir, "MISSING.md");
		await runResponseValidatorCheck(missingPath);
		const expectedPath = path.join(dir, "validator-check-output.md");
		assert.equal(existsSync(expectedPath), false);
	});
	console.log("✓ runResponseValidatorCheck ignores missing file");
}
