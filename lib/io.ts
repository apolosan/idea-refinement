import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Authoritative M1 denominator for atomic persistence coverage.
 * These root artifacts plus the per-loop snapshot files below are the
 * workflow-critical write paths that must never bypass atomic persistence.
 */
export const CRITICAL_WORKFLOW_ROOT_BASENAMES = Object.freeze([
	"run.json",
	"DIRECTIVE.md",
	"LEARNING.md",
	"CRITERIA.md",
	"DIAGNOSIS.md",
	"METRICS.md",
	"BACKLOG.md",
	"RESPONSE.md",
	"FEEDBACK.md",
	"REPORT.md",
	"CHECKLIST.md",
] as const);

export const CRITICAL_WORKFLOW_LOOP_BASENAMES = Object.freeze([
	"RESPONSE.md",
	"FEEDBACK.md",
	"LEARNING.md",
	"BACKLOG.md",
] as const);

export function isCriticalWorkflowArtifactPath(filePath: string): boolean {
	const normalized = filePath.split(path.sep).join("/");
	const basename = path.posix.basename(normalized);
	const inCallDir = normalized.includes("/docs/idea_refinement/artifacts_call_") || normalized.startsWith("docs/idea_refinement/artifacts_call_");
	if (!inCallDir) return false;

	const inLoopDir = /(?:^|\/)docs\/idea_refinement\/artifacts_call_\d+\/loops\/loop_\d+\//.test(normalized);
	if (inLoopDir) {
		return (CRITICAL_WORKFLOW_LOOP_BASENAMES as readonly string[]).includes(basename);
	}

	return (CRITICAL_WORKFLOW_ROOT_BASENAMES as readonly string[]).includes(basename);
}

export interface AtomicWriteOptions {
	beforeRename?: (details: { filePath: string; tempPath: string }) => Promise<void> | void;
	tempPath?: string;
}

/**
 * M8 fix: normalizeMarkdown moved from validation.ts to io.ts
 * since it's only used by writeMarkdownFile here.
 */
export function normalizeMarkdown(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n").trim();
	return normalized.length === 0 ? "" : `${normalized}\n`;
}

async function syncDirectoryIfPossible(directoryPath: string): Promise<void> {
	try {
		const directoryHandle = await fs.open(directoryPath, "r");
		try {
			await directoryHandle.sync();
		} finally {
			await directoryHandle.close();
		}
	} catch {
		// Best-effort durability flush. Some platforms/filesystems do not allow directory fsync.
	}
}

async function removeIfExists(filePath: string): Promise<void> {
	try {
		await fs.rm(filePath, { force: true });
	} catch {
		// Best-effort cleanup.
	}
}

export async function atomicWriteTextFile(filePath: string, content: string, options: AtomicWriteOptions = {}): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });

	const tempPath = options.tempPath ?? path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`,
	);
	const fileHandle = await fs.open(tempPath, "w");
	let renamed = false;

	try {
		await fileHandle.writeFile(content, "utf8");
		await fileHandle.sync();
	} finally {
		await fileHandle.close();
	}

	try {
		await options.beforeRename?.({ filePath, tempPath });
		await fs.rename(tempPath, filePath);
		renamed = true;
		await syncDirectoryIfPossible(path.dirname(filePath));
	} finally {
		if (!renamed) {
			await removeIfExists(tempPath);
		}
	}
}

export async function copyTextFileAtomic(sourcePath: string, targetPath: string): Promise<boolean> {
	let content: string;
	try {
		content = await fs.readFile(sourcePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
	await atomicWriteTextFile(targetPath, content);
	return true;
}

export async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
	// O3 fix: Validate that content is not empty before writing
	if (!content || content.trim().length === 0) {
		throw new Error(`Cannot write empty content to ${filePath}. Validation failed: content is empty.`);
	}
	await atomicWriteTextFile(filePath, normalizeMarkdown(content));
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
	// JSON artifacts must preserve structural whitespace; do not run markdown-oriented trim/normalization here.
	await atomicWriteTextFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
