/**
 * Shared constants for response validation.
 * Extracted to avoid duplication between response-validator.ts and validator-check.ts.
 */

export const REQUIRED_SECTIONS = [
	"Loop framing",
	"Focused loop diagnosis",
	"Minimum alternatives matrix",
	"Current state vs. proposed state",
	"Iteration decision",
	"Explicit discards of this iteration",
	"Next focuses",
];

export const EPISTEMIC_TAGS = ["[FACT]", "[INFERENCE]", "[HYPOTHESIS]", "[PROPOSAL]", "[DECISION]", "[RISK]"];

export const DECISION_TERMS = ["Keep", "Adjust", "Discard", "Test later"];

/** Minimum non-empty lines for a valid response */
export const MIN_LINE_COUNT = 50;

/** Minimum epistemic tags required */
export const MIN_TAG_COUNT = 3;

/** Minimum decision terms required */
export const MIN_DECISION_COUNT = 2;

/** Minimum [FACT] citations required for passing C6 */
export const MIN_FACT_COUNT = 2;
