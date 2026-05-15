import assert from "node:assert/strict";
import { validateChecklistArtifact, validateReportArtifact } from "../../lib/final-artifact-validator.ts";

export async function run(): Promise<void> {
	const validReport = [
		"# Investigation Report",
		"## Executive summary",
		"## Context and investigation object",
		"## Applied methodology",
		"## Main findings (by criterion)",
		"## Score evolution (consolidated scoreboard)",
		"## Firm decisions and active hypotheses",
		"## Identified risks and mitigations",
		"## Final recommendations",
		"## Cross-references (artifacts by loop)",
	].join("\n\n");
	assert.equal(validateReportArtifact(validReport).passed, true);

	const invalidReport = "# Investigation Report\n\n## Executive summary\n";
	const reportResult = validateReportArtifact(invalidReport);
	assert.equal(reportResult.passed, false);
	assert.ok(reportResult.missingHeadings.includes("## Final recommendations"));
	console.log("✓ validateReportArtifact enforces required headings");

	const validChecklist = [
		"# Action Checklist",
		"## Immediate actions (P0)",
		"## Short-term actions (P1)",
		"## Medium-term actions (P2)",
		"## Long-term actions (P3)",
		"## Dependencies between actions",
		"## Acceptance criteria per action",
	].join("\n\n");
	assert.equal(validateChecklistArtifact(validChecklist).passed, true);

	const invalidChecklist = "# Action Checklist\n\n## Immediate actions (P0)\n";
	const checklistResult = validateChecklistArtifact(invalidChecklist);
	assert.equal(checklistResult.passed, false);
	assert.ok(checklistResult.missingHeadings.includes("## Acceptance criteria per action"));
	console.log("✓ validateChecklistArtifact enforces required headings");
}
