export interface ExtractMarkedSectionsOptions {
	/**
	 * Recovery mode for diagnostics/raw-attempt handling. When true, the parser can infer
	 * a section from consecutive BEGIN markers even when END markers are missing.
	 * Production success paths should keep this false.
	 */
	allowSequentialBegins?: boolean;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Collapses common LLM marker variants into the strict `<<<BEGIN FILE: name>>>` / `<<<END FILE: name>>>`
 * spelling so extraction and diagnostics are not fooled by spaces around colons,
 * casing drift, or `END OF FILE` phrasing.
 */
function canonicalizeMarkerDelimiters(text: string): string {
	let s = text;
	s = s.replace(/<<<\s*BEGIN\s+FILE\s*:\s*(.+?)\s*>>>/gi, (_m, label: string) => `<<<BEGIN FILE: ${String(label).trim()}>>>`);
	s = s.replace(/<<<\s*END\s+OF\s+FILE\s*:\s*(.+?)\s*>>>/gi, (_m, label: string) => `<<<END FILE: ${String(label).trim()}>>>`);
	s = s.replace(/<<<\s*END\s+FILE\s*:\s*(.+?)\s*>>>/gi, (_m, label: string) => `<<<END FILE: ${String(label).trim()}>>>`);
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
 * Scans for begin/end pairs where labels may be full paths, but the basename
 * matches the expected artifact name.
 */
function tryExtractSectionByBasename(normalized: string, fileName: string): string | null {
	const expected = fileName.trim().toLowerCase();
	if (!expected) return null;

	const beginRe = /<<<BEGIN FILE:\s*(.+?)>>>/g;
	const endRe = /<<<END FILE:\s*(.+?)>>>/g;

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
 * Recovery strategy: infer spans between consecutive BEGIN headers.
 * This is useful for diagnostics/raw-attempt recovery, but it is unsafe for
 * success validation because the final artifact might be truncated.
 */
function tryExtractSectionSequentialBegins(normalized: string, fileName: string): string | null {
	const expected = fileName.trim().toLowerCase();
	if (!expected) return null;

	const beginRe = /<<<BEGIN FILE:\s*(.+?)>>>/g;
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
		body = body.replace(new RegExp(`(?:\\n|^)<<<END FILE:\\s*${esc}>>>\\s*$`, "i"), "").trimEnd();
		return body;
	}

	return null;
}

/**
 * Validate that each extracted section has minimum content (10 non-whitespace chars).
 */
const MIN_SECTION_CONTENT_LENGTH = 10;

/**
 * Strips markdown code fences (``` ... ```) from text to help match markers
 * that may be wrapped inside them by the LLM.
 */
function stripMarkdownCodeFences(text: string): string {
	return text
		.replace(/```(?:markdown|md|text)?\s*\n?/g, "")
		.replace(/```/g, "");
}

/**
 * Attempts to extract a marked section using progressively more lenient complete-marker strategies.
 * Missing END-marker recovery is opt-in via `allowSequentialBegins`.
 */
function tryExtractSection(normalized: string, fileName: string, options: ExtractMarkedSectionsOptions): string | null {
	const escapedName = escapeRegExp(fileName);
	const markerName = `FILE:\\s*${escapedName}`;

	// Strategy 1: strict pair, content on following lines.
	let match = normalized.match(
		new RegExp(
			`<<<BEGIN ${markerName}>>>\\s*\\n([\\s\\S]*?)\\n<<<END ${markerName}>>>`,
			"m",
		),
	);
	if (match) return (match[1] ?? "").trim();

	// Strategy 2: content may start on the same line as the begin marker.
	match = normalized.match(
		new RegExp(
			`<<<BEGIN ${markerName}>>>\\s*([\\s\\S]*?)<<<END ${markerName}>>>`,
			"m",
		),
	);
	if (match) return (match[1] ?? "").trim();

	// Strategy 3: strip markdown code fences before matching.
	const stripped = stripMarkdownCodeFences(normalized);
	if (stripped !== normalized) {
		const fenced = tryExtractSection(stripped, fileName, { allowSequentialBegins: false });
		if (fenced !== null) return fenced;
	}

	// Strategy 4: labels sharing the correct basename, including path-prefixed labels.
	let byBasename = tryExtractSectionByBasename(normalized, fileName);
	if (byBasename === null && stripped !== normalized) byBasename = tryExtractSectionByBasename(stripped, fileName);
	if (byBasename !== null) return byBasename;

	// Strategy 5: opt-in recovery for BEGIN-only streams.
	if (options.allowSequentialBegins) {
		let sequential = tryExtractSectionSequentialBegins(normalized, fileName);
		if (sequential === null && stripped !== normalized) sequential = tryExtractSectionSequentialBegins(stripped, fileName);
		if (sequential !== null) return sequential;
	}

	return null;
}

/**
 * Returns a diagnostic snippet of text around the first occurrence of a marker keyword,
 * used to help debug why extraction failed.
 */
function getDiagnosticSnippet(text: string, keyword: string, contextRadius = 200): string {
	const index = text.toLowerCase().indexOf(keyword.toLowerCase());
	if (index === -1) {
		const snippet = text.slice(0, contextRadius);
		return snippet.length < text.length ? `${snippet}...` : snippet;
	}
	const start = Math.max(0, index - Math.floor(contextRadius / 2));
	const end = Math.min(text.length, index + Math.floor(contextRadius / 2));
	const prefix = start > 0 ? "..." : "";
	const suffix = end < text.length ? "..." : "";
	return `${prefix}${text.slice(start, end)}${suffix}`;
}

export function extractMarkedSections(rawText: string, fileNames: string[], options: ExtractMarkedSectionsOptions = {}): Record<string, string> {
	const normalized = canonicalizeMarkerDelimiters(rawText.replace(/\r\n/g, "\n"));
	const sections: Record<string, string> = {};
	const missing: string[] = [];
	const insufficient: Array<{ name: string; length: number }> = [];

	for (const fileName of fileNames) {
		const content = tryExtractSection(normalized, fileName, options);

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
