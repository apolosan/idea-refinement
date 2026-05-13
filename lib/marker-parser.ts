function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Collapses common LLM marker variants into the strict `<<<BEGIN FILE:name>>>` / `<<<END FILE:name>>>`
 * spelling so regex strategies (1–4) and diagnostics that count `<<<END FILE:` are not fooled by
 * spaces around colons, casing drift, or `END OF FILE` phrasing.
 */
function canonicalizeMarkerDelimiters(text: string): string {
	let s = text;
	s = s.replace(/<<<\s*BEGIN\s+FILE\s*:\s*(.+?)\s*>>>/gi, (_m, label: string) => `<<<BEGIN FILE:${String(label).trim()}>>>`);
	s = s.replace(/<<<\s*END\s+OF\s+FILE\s*:\s*(.+?)\s*>>>/gi, (_m, label: string) => `<<<END FILE:${String(label).trim()}>>>`);
	s = s.replace(/<<<\s*END\s+FILE\s*:\s*(.+?)\s*>>>/gi, (_m, label: string) => `<<<END FILE:${String(label).trim()}>>>`);
	return s;
}

/** Last path segment, tolerating both `/` and `\\` in LLM output. */
function markerLabelBasename(label: string): string {
	const trimmed = label.trim();
	if (!trimmed) return "";
	const normalizedSlashes = trimmed.replace(/\\/g, "/");
	const parts = normalizedSlashes.split("/");
	return (parts[parts.length - 1] ?? trimmed).trim();
}

/**
 * Strategy 5: scan for begin/end pairs where the label is a full path or relative path,
 * but basename matches the expected artifact name (e.g. `docs/.../FEEDBACK.md` vs `FEEDBACK.md`).
 * Also tolerates extra spaces inside markers (`<<< BEGIN FILE : name >>>`).
 */
function tryExtractSectionByBasename(normalized: string, fileName: string): string | null {
	const expected = fileName.trim().toLowerCase();
	if (!expected) return null;

	const beginRe = /<<<\s*BEGIN\s+FILE\s*:\s*(.+?)\s*>>>/g;
	const endRe = /<<<\s*END\s+FILE\s*:\s*(.+?)\s*>>>/g;

	let beginMatch: RegExpExecArray | null;
	while ((beginMatch = beginRe.exec(normalized)) !== null) {
		const innerBegin = beginMatch[1] ?? "";
		if (markerLabelBasename(innerBegin).toLowerCase() !== expected) continue;

		const contentStart = beginMatch.index + beginMatch[0].length;
		const tail = normalized.slice(contentStart);
		endRe.lastIndex = 0;

		let endMatch: RegExpExecArray | null;
		while ((endMatch = endRe.exec(tail)) !== null) {
			const innerEnd = endMatch[1] ?? "";
			if (markerLabelBasename(innerEnd).toLowerCase() === expected) {
				return tail.slice(0, endMatch.index).trim();
			}
		}
	}

	return null;
}

/**
 * Strategy 6: infer spans between consecutive <<<BEGIN FILE:...>>> headers.
 * Handles models that omit END markers (token truncation) while still emitting all BEGIN headers.
 */
function tryExtractSectionSequentialBegins(normalized: string, fileName: string): string | null {
	const expected = fileName.trim().toLowerCase();
	if (!expected) return null;

	const beginRe = /<<<BEGIN FILE:(.+?)>>>/g;
	const headers: Array<{ rawLabel: string; index: number; headerLen: number }> = [];
	let m: RegExpExecArray | null;
	while ((m = beginRe.exec(normalized)) !== null) {
		headers.push({ rawLabel: (m[1] ?? "").trim(), index: m.index, headerLen: m[0].length });
	}
	if (headers.length === 0) return null;

	for (let i = 0; i < headers.length; i++) {
		const basename = markerLabelBasename(headers[i].rawLabel).toLowerCase();
		if (basename !== expected) continue;

		const bodyStart = headers[i].index + headers[i].headerLen;
		const bodyEnd = i + 1 < headers.length ? headers[i + 1].index : normalized.length;
		let body = normalized.slice(bodyStart, bodyEnd).trim();
		const esc = escapeRegExp(basename);
		body = body.replace(new RegExp(`(?:\\n|^)<<<END FILE:${esc}>>>\\s*$`, "i"), "").trimEnd();
		return body;
	}

	return null;
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
 * Strategy 5: Basename / flexible-marker scan — tolerates path-prefixed labels and extra spaces inside `<<< >>>`
 * Strategy 6: Sequential BEGIN-only spans — tolerates missing END markers (truncation)
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

	// Strategy 5: path-prefixed or otherwise mismatched labels sharing the correct basename
	let byBasename = tryExtractSectionByBasename(normalized, fileName);
	if (byBasename === null) {
		const stripped = stripMarkdownCodeFences(normalized);
		if (stripped !== normalized) byBasename = tryExtractSectionByBasename(stripped, fileName);
	}
	if (byBasename !== null) return byBasename;

	// Strategy 6: sequential BEGIN headers only (truncation / missing END markers)
	let sequential = tryExtractSectionSequentialBegins(normalized, fileName);
	if (sequential === null) {
		const strippedSeq = stripMarkdownCodeFences(normalized);
		if (strippedSeq !== normalized) sequential = tryExtractSectionSequentialBegins(strippedSeq, fileName);
	}
	if (sequential !== null) return sequential;

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
	const normalized = canonicalizeMarkerDelimiters(rawText.replace(/\r\n/g, "\n"));
	const sections: Record<string, string> = {};
	const missing: string[] = [];
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
