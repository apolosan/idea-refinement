function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * O3 fix: Validate that each extracted section has minimum content (10 non-whitespace chars).
 * Previously, empty content was silently accepted, which could break the workflow.
 */
const MIN_SECTION_CONTENT_LENGTH = 10;

export function extractMarkedSections(rawText: string, fileNames: string[]): Record<string, string> {
	const normalized = rawText.replace(/\r\n/g, "\n");
	const sections: Record<string, string> = {};

	for (const fileName of fileNames) {
		const pattern = new RegExp(
			`<<<BEGIN FILE: ${escapeRegExp(fileName)}>>>\\s*\\n([\\s\\S]*?)\\n<<<END FILE: ${escapeRegExp(fileName)}>>>`,
			"m",
		);
		const match = normalized.match(pattern);
		if (!match) {
			throw new Error(`Missing marked section for ${fileName}.`);
		}

		const content = (match[1] ?? "").trim();
		// O3 fix: Fail explicitly if section is empty, don't let workflow proceed silently
		const nonWhitespaceContent = content.replace(/\s/g, "");
		if (nonWhitespaceContent.length < MIN_SECTION_CONTENT_LENGTH) {
			throw new Error(
				`Section ${fileName} has insufficient content (${nonWhitespaceContent.length} chars, minimum ${MIN_SECTION_CONTENT_LENGTH}). Validation failed.`,
			);
		}

		sections[fileName] = content;
	}

	return sections;
}
