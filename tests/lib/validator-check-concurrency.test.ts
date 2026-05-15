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

const VALID_RESPONSE = [
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

export async function run(): Promise<void> {
	// B36: Concurrency test — run multiple validator checks in parallel
	// Verifies that async fs/promises migration does not cause race conditions
	await withTempDir(async (dir) => {
		const CONCURRENCY = 8;
		const dirs: string[] = [];

		// Create N separate RESPONSE.md files in separate subdirectories
		for (let i = 0; i < CONCURRENCY; i++) {
			const subDir = path.join(dir, `check-${i}`);
			await fs.mkdir(subDir, { recursive: true });
			const responsePath = path.join(subDir, "RESPONSE.md");
			await fs.writeFile(responsePath, VALID_RESPONSE, "utf-8");
			dirs.push(subDir);
		}

		// Run all validator checks concurrently
		await Promise.all(
			dirs.map((subDir) =>
				runResponseValidatorCheck(path.join(subDir, "RESPONSE.md"))
			)
		);

		// Verify all outputs were written correctly (no race-condition corruption)
		for (let i = 0; i < CONCURRENCY; i++) {
			const outputPath = path.join(dirs[i], "validator-check-output.md");
			assert.equal(existsSync(outputPath), true, `Output ${i} must exist`);
			const output = readFileSync(outputPath, "utf-8");
			assert.match(output, /Validator Check/, `Output ${i} must contain header`);
			assert.match(output, /Score/, `Output ${i} must contain score`);
			// Verify no corruption: output should be valid markdown with proper structure
			assert.match(output, /\| Check \|/, `Output ${i} must have check table`);
		}

		console.log(`✓ validator-check concurrency: ${CONCURRENCY} parallel runs completed without race conditions`);
	});

	// B36: Stress test — concurrent runs with mixed valid and missing files
	await withTempDir(async (dir) => {
		const validDir = path.join(dir, "valid");
		const missingDir = path.join(dir, "missing");
		await fs.mkdir(validDir, { recursive: true });
		await fs.mkdir(missingDir, { recursive: true });
		await fs.writeFile(path.join(validDir, "RESPONSE.md"), VALID_RESPONSE, "utf-8");

		// Mix valid and missing files in parallel
		await Promise.all([
			runResponseValidatorCheck(path.join(validDir, "RESPONSE.md")),
			runResponseValidatorCheck(path.join(missingDir, "MISSING.md")),
			runResponseValidatorCheck(path.join(validDir, "RESPONSE.md")),
			runResponseValidatorCheck(path.join(missingDir, "MISSING.md")),
		]);

		// Valid outputs should exist; missing file outputs should NOT exist
		assert.equal(existsSync(path.join(validDir, "validator-check-output.md")), true);
		assert.equal(existsSync(path.join(missingDir, "validator-check-output.md")), false);
		console.log("✓ validator-check concurrency: mixed valid/missing files handled correctly");
	});
}
