export interface FinalArtifactValidationResult {
	passed: boolean;
	missingHeadings: string[];
}

const REPORT_REQUIRED_HEADINGS = [
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
];

const CHECKLIST_REQUIRED_HEADINGS = [
	"# Action Checklist",
	"## Immediate actions (P0)",
	"## Short-term actions (P1)",
	"## Medium-term actions (P2)",
	"## Long-term actions (P3)",
	"## Dependencies between actions",
	"## Acceptance criteria per action",
];

function normalizeLine(line: string): string {
	return line.replace(/\s+/g, " ").trim().toLowerCase();
}

function validateRequiredHeadings(text: string, requiredHeadings: readonly string[]): FinalArtifactValidationResult {
	const normalizedLines = new Set(text.replace(/\r\n/g, "\n").split("\n").map(normalizeLine));
	const missingHeadings = requiredHeadings.filter((heading) => !normalizedLines.has(normalizeLine(heading)));
	return {
		passed: missingHeadings.length === 0,
		missingHeadings,
	};
}

export function validateReportArtifact(text: string): FinalArtifactValidationResult {
	return validateRequiredHeadings(text, REPORT_REQUIRED_HEADINGS);
}

export function validateChecklistArtifact(text: string): FinalArtifactValidationResult {
	return validateRequiredHeadings(text, CHECKLIST_REQUIRED_HEADINGS);
}
