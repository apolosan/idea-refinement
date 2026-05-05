function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * O3 fix: Validate that each extracted section has minimum content (10 non-whitespace chars).
 * Previously, empty content was silently accepted, which could break the workflow.
 */
const MIN_SECTION_CONTENT_LENGTH = 10;

/**
 * Strips markdown code fences (``` ... ```) from text to help match markers
 * that may be wrapped inside them by the LLM.
 */
function stripMarkdownCodeFences(text: string): string {
	// Remove fenced code blocks: ```markdown ... ``` or ``` ... ```
	// Handles optional language specifier after opening fence
	return text
		.replace(/```(?:markdown|md|text)?\s*\n?/g, "")
		.replace(/```/g, "");
}

/**
 * Attempts to extract a marked section using progressively more lenient strategies.
 *
 * Strategy 1: Exact match (original strict regex, multiline)
 * Strategy 2: Same markers but allowing content on same line as begin/end
 * Strategy 3: Strip markdown code fences first, then try exact match
 * Strategy 4: Lenient — allow any whitespace between markers and content
 */
function tryExtractSection(normalized: string, fileName: string): string | null {
	const escapedName = escapeRegExp(fileName);

	// Strategy 1: Original strict pattern — requires newline after begin and before end
	let match = normalized.match(
		new RegExp(
			`<<<BEGIN FILE: ${escapedName}>>>\\s*\\n([\\s\\S]*?)\\n<<<END FILE: ${escapedName}>>>`,
			"m",
		),
	);
	if (match) return (match[1] ?? "").trim();

	// Strategy 2: Content may start on the same line as begin marker
	match = normalized.match(
		new RegExp(
			`<<<BEGIN FILE: ${escapedName}>>>\\s*([\\s\\S]*?)\\n<<<END FILE: ${escapedName}>>>`,
			"m",
		),
	);
	if (match) return (match[1] ?? "").trim();

	// Strategy 3: Strip markdown code fences before matching
	const stripped = stripMarkdownCodeFences(normalized);
	if (stripped !== normalized) {
		match = stripped.match(
			new RegExp(
				`<<<BEGIN FILE: ${escapedName}>>>\\s*\\n?([\\s\\S]*?)\\n?<<<END FILE: ${escapedName}>>>`,
				"m",
			),
		);
		if (match) return (match[1] ?? "").trim();
	}

	// Strategy 4: Most lenient — allow any whitespace layout
	match = normalized.match(
		new RegExp(
			`<<<BEGIN FILE: ${escapedName}>>>\\s*([\\s\\S]*?)<<<END FILE: ${escapedName}>>>`,
			"m",
		),
	);
	if (match) return (match[1] ?? "").trim();

	return null;
}

/**
 * Returns a diagnostic snippet of text around the first occurrence of a marker keyword,
 * used to help debug why extraction failed.
 */
function getDiagnosticSnippet(text: string, keyword: string, contextRadius = 200): string {
	const index = text.toLowerCase().indexOf(keyword.toLowerCase());
	if (index === -1) {
		// No marker at all — return start of text
		const snippet = text.slice(0, contextRadius);
		return snippet.length < text.length ? `${snippet}...` : snippet;
	}
	const start = Math.max(0, index - Math.floor(contextRadius / 2));
	const end = Math.min(text.length, index + Math.floor(contextRadius / 2));
	const prefix = start > 0 ? "..." : "";
	const suffix = end < text.length ? "..." : "";
	return `${prefix}${text.slice(start, end)}${suffix}`;
}

export function extractMarkedSections(rawText: string, fileNames: string[]): Record<string, string> {
	const normalized = rawText.replace(/\r\n/g, "\n");
	const sections: Record<string, string> = {};
	const missing: string[] = []
	const insufficient: Array<{ name: string; length: number }> = [];

	for (const fileName of fileNames) {
		const content = tryExtractSection(normalized, fileName);

		if (content === null) {
			missing.push(fileName);
			continue;
		}

		const nonWhitespaceContent = content.replace(/\s/g, "");
		if (nonWhitespaceContent.length < MIN_SECTION_CONTENT_LENGTH) {
			insufficient.push({ name: fileName, length: nonWhitespaceContent.length });
			continue;
		}

		sections[fileName] = content;
	}

	if (missing.length > 0 || insufficient.length > 0) {
		const parts: string[] = [];
		if (missing.length > 0) {
			parts.push(`Missing marked section(s) for: ${missing.join(", ")}.`);
		}
		if (insufficient.length > 0) {
			for (const { name, length } of insufficient) {
				parts.push(
					`Section ${name} has insufficient content (${length} chars, minimum ${MIN_SECTION_CONTENT_LENGTH}).`,
				);
			}
		}
		// Add diagnostic info about what was received
		const markerKeywords = [...missing, ...insufficient.map((i) => i.name)];
		const primaryKeyword = markerKeywords[0];
		if (primaryKeyword) {
			const snippet = getDiagnosticSnippet(normalized, `<<<BEGIN FILE: ${primaryKeyword}>>>`);
			const totalLength = normalized.length;
			const beginCount = (normalized.match(/<<<BEGIN FILE:/g) || []).length;
			const endCount = (normalized.match(/<<<END FILE:/g) || []).length;
			parts.push(
				`[Diagnostic: ${beginCount} begin marker(s), ${endCount} end marker(s) found in ${totalLength} chars. Snippet near "${primaryKeyword}": ${snippet}]`,
			);
		}
		throw new Error(parts.join(" "));
	}

	return sections;
}
