import assert from "node:assert/strict";
import { extractMarkedSections } from "../../lib/marker-parser.ts";

export async function run(): Promise<void> {
	// Basic extraction
	const sections = extractMarkedSections(
		`<<<BEGIN FILE: DIRECTIVE.md>>>
alpha content that satisfies minimum length requirement
<<<END FILE: DIRECTIVE.md>>>
<<<BEGIN FILE: LEARNING.md>>>
beta content that satisfies minimum length requirement
<<<END FILE: LEARNING.md>>>
<<<BEGIN FILE: CRITERIA.md>>>
gamma content that satisfies minimum length requirement
<<<END FILE: CRITERIA.md>>>`,
		["DIRECTIVE.md", "LEARNING.md", "CRITERIA.md"],
	);
	assert.equal(sections["DIRECTIVE.md"], "alpha content that satisfies minimum length requirement");
	assert.equal(sections["LEARNING.md"], "beta content that satisfies minimum length requirement");
	assert.equal(sections["CRITERIA.md"], "gamma content that satisfies minimum length requirement");
	console.log("✓ extractMarkedSections splits artifacts correctly");

	// Missing section
	assert.throws(
		() => extractMarkedSections("", ["MISSING.md"]),
		/Missing marked section/,
	);
	console.log("✓ extractMarkedSections throws error when section is missing");

	// Insufficient content (less than 10 non-whitespace chars)
	assert.throws(
		() => extractMarkedSections(`<<<BEGIN FILE: SHORT.md>>>\na\n<<<END FILE: SHORT.md>>>`, ["SHORT.md"]),
		/insufficient content/,
	);
	console.log("✓ extractMarkedSections throws error when content is insufficient");

	// Multiple sections with \r\n
	const crlfSections = extractMarkedSections(
		`<<<BEGIN FILE: A.md>>>\r\nthis has enough content for validation\r\n<<<END FILE: A.md>>>\r\n<<<BEGIN FILE: B.md>>>\r\nalso enough content here for sure\r\n<<<END FILE: B.md>>>`,
		["A.md", "B.md"],
	);
	assert.ok(crlfSections["A.md"].includes("enough content"));
	assert.ok(crlfSections["B.md"].includes("also enough"));
	console.log("✓ extractMarkedSections normalizes CRLF correctly");

	// Strategy 2: Content on same line as begin marker
	const sameLineSections = extractMarkedSections(
		`<<<BEGIN FILE: DIRECTIVE.md>>>content starts right here without newline <<<END FILE: DIRECTIVE.md>>>`,
		["DIRECTIVE.md"],
	);
	assert.ok(sameLineSections["DIRECTIVE.md"].includes("content starts right here"));
	console.log("✓ extractMarkedSections handles content on same line as begin marker");

	// Strategy 3: Markers wrapped in markdown code fences
	const fencedSections = extractMarkedSections(
		`\`\`\`markdown
<<<BEGIN FILE: DIRECTIVE.md>>>
This is the directive content with enough characters to pass validation.
<<<END FILE: DIRECTIVE.md>>>
\`\`\``,
		["DIRECTIVE.md"],
	);
	assert.ok(fencedSections["DIRECTIVE.md"].includes("directive content"));
	console.log("✓ extractMarkedSections strips markdown code fences before matching");

	// Strategy 4: Lenient matching — minimal whitespace
	const lenientSections = extractMarkedSections(
		`<<<BEGIN FILE: DIRECTIVE.md>>>This is enough content for lenient matching<<<END FILE: DIRECTIVE.md>>>`,
		["DIRECTIVE.md"],
	);
	assert.ok(lenientSections["DIRECTIVE.md"].includes("lenient matching"));
	console.log("✓ extractMarkedSections handles lenient marker matching");

	// Strategy 5: Path-prefixed labels (basename match)
	const pathPrefixed = extractMarkedSections(
		`<<<BEGIN FILE: docs/idea_refinement/artifacts_call_06/FEEDBACK.md>>>
This is feedback body text with sufficient non-whitespace content.
<<<END FILE: FEEDBACK.md>>>
<<<BEGIN FILE: ./nested/LEARNING.md>>>
Learning section content is long enough to validate here.
<<<END FILE: docs/x/LEARNING.md>>>
<<<BEGIN FILE: BACKLOG.md>>>
Backlog section has enough characters for the parser minimum.
<<<END FILE: BACKLOG.md>>>`,
		["FEEDBACK.md", "LEARNING.md", "BACKLOG.md"],
	);
	assert.ok(pathPrefixed["FEEDBACK.md"].includes("feedback body"));
	assert.ok(pathPrefixed["LEARNING.md"].includes("Learning section"));
	assert.ok(pathPrefixed["BACKLOG.md"].includes("Backlog section"));
	console.log("✓ extractMarkedSections matches basename when markers include paths");

	// Strategy 5b: Flexible whitespace inside markers
	const spacedMarkers = extractMarkedSections(
		`<<< BEGIN FILE : FEEDBACK.md >>>
Spaced marker feedback content is still long enough.
<<< END FILE : FEEDBACK.md >>>`,
		["FEEDBACK.md"],
	);
	assert.ok(spacedMarkers["FEEDBACK.md"].includes("Spaced marker"));
	console.log("✓ extractMarkedSections tolerates extra spaces inside marker tokens");

	// Canonicalization: strict BEGIN + spaced / lowercase END still pairs
	const mixedEndMarkers = extractMarkedSections(
		`<<<BEGIN FILE: DIRECTIVE.md>>>
This directive body is long enough for the parser minimum.
<<< end file : DIRECTIVE.md >>>`,
		["DIRECTIVE.md"],
	);
	assert.ok(mixedEndMarkers["DIRECTIVE.md"].includes("directive body"));
	console.log("✓ extractMarkedSections canonicalizes lowercase/spaced END markers");

	const endOfFileSynonym = extractMarkedSections(
		`<<<BEGIN FILE: DIRECTIVE.md>>>
Synonym end marker test with sufficient content length.
<<<END OF FILE: DIRECTIVE.md>>>`,
		["DIRECTIVE.md"],
	);
	assert.ok(endOfFileSynonym["DIRECTIVE.md"].includes("Synonym end"));
	console.log("✓ extractMarkedSections accepts END OF FILE closing synonym");

	// Recovery mode: no END markers are rejected by default, then accepted only when explicitly requested.
	const beginOnlyPayload = `<<<BEGIN FILE: DIRECTIVE.md>>>
Directive body with enough non-whitespace characters here.
<<<BEGIN FILE: LEARNING.md>>>
Learning body with enough non-whitespace characters here.
<<<BEGIN FILE: CRITERIA.md>>>
Criteria body with enough non-whitespace characters here.
<<<BEGIN FILE: DIAGNOSIS.md>>>
Diagnosis body with enough non-whitespace characters here.
<<<BEGIN FILE: METRICS.md>>>
Metrics body with enough non-whitespace characters here.
<<<BEGIN FILE: BACKLOG.md>>>
Backlog body with enough non-whitespace characters here.`;
	assert.throws(
		() => extractMarkedSections(beginOnlyPayload, ["DIRECTIVE.md", "LEARNING.md", "CRITERIA.md", "DIAGNOSIS.md", "METRICS.md", "BACKLOG.md"]),
		/Missing marked section/,
	);
	const beginOnlyBootstrap = extractMarkedSections(
		beginOnlyPayload,
		["DIRECTIVE.md", "LEARNING.md", "CRITERIA.md", "DIAGNOSIS.md", "METRICS.md", "BACKLOG.md"],
		{ allowSequentialBegins: true },
	);
	assert.ok(beginOnlyBootstrap["DIRECTIVE.md"].includes("Directive body"));
	assert.ok(beginOnlyBootstrap["BACKLOG.md"].includes("Backlog body"));
	console.log("✓ extractMarkedSections rejects missing END markers unless recovery mode is enabled");

	// Error message includes diagnostic info
	try {
		extractMarkedSections("Some random text without markers", ["DIRECTIVE.md"]);
		assert.fail("Should have thrown");
	} catch (error) {
		assert.ok(error instanceof Error);
		assert.ok(error.message.includes("Missing marked section"), `Expected "Missing marked section" in: ${error.message}`);
		assert.ok(error.message.includes("Diagnostic"), `Expected "Diagnostic" in: ${error.message}`);
	}
	console.log("✓ extractMarkedSections includes diagnostic info in error message");

	// Multiple missing sections reported together
	try {
		extractMarkedSections("No markers at all", ["DIRECTIVE.md", "LEARNING.md"]);
		assert.fail("Should have thrown");
	} catch (error) {
		assert.ok(error instanceof Error);
		assert.ok(error.message.includes("DIRECTIVE.md"), `Expected "DIRECTIVE.md" in: ${error.message}`);
		assert.ok(error.message.includes("LEARNING.md"), `Expected "LEARNING.md" in: ${error.message}`);
	}
	console.log("✓ extractMarkedSections reports all missing sections in one error");
}