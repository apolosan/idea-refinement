import assert from "node:assert/strict";
import { extractMarkedSections } from "../../lib/marker-parser.ts";

export async function run(): Promise<void> {
	// Extração básica
	const sections = extractMarkedSections(
		`<<<BEGIN FILE: DIRECTIVE.md>>>
alpha content
<<<END FILE: DIRECTIVE.md>>>
<<<BEGIN FILE: LEARNING.md>>>
beta content
<<<END FILE: LEARNING.md>>>
<<<BEGIN FILE: CRITERIA.md>>>
gamma content
<<<END FILE: CRITERIA.md>>>`,
		["DIRECTIVE.md", "LEARNING.md", "CRITERIA.md"],
	);
	assert.equal(sections["DIRECTIVE.md"], "alpha content");
	assert.equal(sections["LEARNING.md"], "beta content");
	assert.equal(sections["CRITERIA.md"], "gamma content");
	console.log("✓ extractMarkedSections separa artefatos corretamente");

	// Seção ausente
	assert.throws(
		() => extractMarkedSections("", ["MISSING.md"]),
		/Missing marked section for MISSING\.md/,
	);
	console.log("✓ extractMarkedSections lança erro quando seção está ausente");

	// Conteúdo insuficiente (menos de 10 chars não-whitespace)
	assert.throws(
		() => extractMarkedSections(`<<<BEGIN FILE: SHORT.md>>>\na\n<<<END FILE: SHORT.md>>>`, ["SHORT.md"]),
		/insufficient content/,
	);
	console.log("✓ extractMarkedSections lança erro quando conteúdo é insuficiente");

	// Múltiplas seções com \r\n
	const crlfSections = extractMarkedSections(
		`<<<BEGIN FILE: A.md>>>\r\nthis has enough content for validation\r\n<<<END FILE: A.md>>>\r\n<<<BEGIN FILE: B.md>>>\r\nalso enough content here for sure\r\n<<<END FILE: B.md>>>`,
		["A.md", "B.md"],
	);
	assert.ok(crlfSections["A.md"].includes("enough content"));
	assert.ok(crlfSections["B.md"].includes("also enough"));
	console.log("✓ extractMarkedSections normaliza CRLF corretamente");
}
