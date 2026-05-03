import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * M8 fix: normalizeMarkdown moved from validation.ts to io.ts
 * since it's only used by writeMarkdownFile here.
 */
export function normalizeMarkdown(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n").trim();
	return normalized.length === 0 ? "" : `${normalized}\n`;
}

export async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
	// O3 fix: Validate that content is not empty before writing
	if (!content || content.trim().length === 0) {
		throw new Error(`Cannot write empty content to ${filePath}. Validation failed: content is empty.`);
	}
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, normalizeMarkdown(content), "utf8");
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
