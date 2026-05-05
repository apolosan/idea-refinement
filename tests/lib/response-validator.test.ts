import assert from "node:assert/strict";
import { validateResponse } from "../../lib/response-validator.ts";

function buildValidResponse(): string {
	return [
		"# Response",
		"## Loop framing",
		"Content here with enough length to satisfy the minimum line count requirement for validation purposes.",
		"## Focused loop diagnosis",
		"[FACT] File reference: src/index.ts",
		"[FACT] Another fact: lib/utils.ts",
		"## Operational questions and applied external research",
		"Some questions here to add more lines to the document for validation.",
		"## Minimum alternatives matrix",
		"| Alt | Problem | Mechanism | Benefit | Cost | Risk |",
		"|-----|---------|-----------|---------|------|------|",
		"| A   | X       | Y         | Z       | Low  | None |",
		"| B   | X2      | Y2        | Z2      | High | Some |",
		"## Current state vs. proposed state",
		"before: baseline 50ms, after: target 30ms (40% improvement)",
		"## Experiment protocol",
		"Steps to execute the experiment properly with clear metrics.",
		"## Iteration decision",
		"Keep the current approach and Adjust parameters.",
		"## Explicit discards of this iteration",
		"Discard alternative C due to excessive cost.",
		"## Next focuses",
		"Test later the integration with external module.",
		"[INFERENCE] Based on the data collected so far.",
		"[RISK] Potential failure in edge cases.",
	].join("\n");
}

function buildInvalidResponseWithStrayRowsOutsideMatrix(): string {
	return buildValidResponse()
		.replace(
			["## Operational questions and applied external research", "Some questions here to add more lines to the document for validation."].join("\n"),
			[
				"## Operational questions and applied external research",
				"Some questions here to add more lines to the document for validation.",
				"| stray | row | outside | the | target | section |",
				"| stray | row | outside | the | target | section |",
				"| stray | row | outside | the | target | section |",
				"| stray | row | outside | the | target | section |",
			].join("\n"),
		)
		.replace(
			[
				"## Minimum alternatives matrix",
				"| Alt | Problem | Mechanism | Benefit | Cost | Risk |",
				"|-----|---------|-----------|---------|------|------|",
				"| A   | X       | Y         | Z       | Low  | None |",
				"| B   | X2      | Y2        | Z2      | High | Some |",
			].join("\n"),
			[
				"## Minimum alternatives matrix",
				"Decision table intentionally omitted here to verify section scoping.",
			].join("\n"),
		);
}

export async function run(): Promise<void> {
	const valid = validateResponse(buildValidResponse());
	assert.equal(valid.passed, true);
	assert.ok(valid.score >= 60);
	assert.ok(valid.checks.length >= 8);
	console.log("✓ validateResponse approves valid response");

	const empty = validateResponse("");
	assert.equal(empty.passed, false);
	assert.ok(empty.score < 60);
	console.log("✓ validateResponse rejects empty response");

	const noTags = validateResponse("x\n".repeat(60));
	assert.equal(noTags.passed, false);
	console.log("✓ validateResponse rejects response without epistemic tags");

	const withAdopt = validateResponse(buildValidResponse().replace("Keep", "Adopt"));
	const adoptCheck = withAdopt.checks.find((c) => c.name.includes("Adopt"));
	assert.equal(adoptCheck?.passed, false);
	console.log("✓ validateResponse detects prohibited use of 'Adopt'");

	const strayRows = validateResponse(buildInvalidResponseWithStrayRowsOutsideMatrix());
	const strayRowsCheck = strayRows.checks.find((c) => c.name.startsWith("C3:"));
	assert.equal(strayRowsCheck?.passed, false);
	assert.match(strayRowsCheck?.detail ?? "", /target section|section found/i);
	console.log("✓ validateResponse rejects stray matrix rows outside the target section");

	const sectionScopedValid = validateResponse(buildValidResponse());
	const sectionScopedValidCheck = sectionScopedValid.checks.find((c) => c.name.startsWith("C3:"));
	assert.equal(sectionScopedValidCheck?.passed, true);
	console.log("✓ validateResponse accepts a real matrix inside the target section");

	const noSections = validateResponse("[FACT] ref\n".repeat(60));
	const sectionChecks = noSections.checks.filter((c) => c.name.startsWith("C2:"));
	assert.ok(sectionChecks.some((c) => !c.passed));
	console.log("✓ validateResponse checks required sections");
}
