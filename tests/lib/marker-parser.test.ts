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