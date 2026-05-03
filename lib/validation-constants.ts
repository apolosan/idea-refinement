/**
 * Shared constants for response validation.
 * Extracted to avoid duplication between response-validator.ts and validator-check.ts.
 */

export const REQUIRED_SECTIONS = [
	"Enquadramento do loop",
	"Diagnóstico focal deste loop",
	"Matriz mínima de alternativas",
	"Estado atual vs. estado proposto",
	"Decisão desta iteração",
	"Descartes explícitos desta iteração",
	"Próximos focos",
];

export const EPISTEMIC_TAGS = ["[FATO]", "[INFERÊNCIA]", "[HIPÓTESE]", "[PROPOSTA]", "[DECISÃO]", "[RISCO]"];

export const DECISION_TERMS = ["Manter", "Ajustar", "Descartar", "Testar depois"];

/** Minimum non-empty lines for a valid response */
export const MIN_LINE_COUNT = 50;

/** Minimum epistemic tags required */
export const MIN_TAG_COUNT = 3;

/** Minimum decision terms required */
export const MIN_DECISION_COUNT = 2;

/** Minimum [FATO] citations required for passing C6 */
export const MIN_FATO_COUNT = 2;
