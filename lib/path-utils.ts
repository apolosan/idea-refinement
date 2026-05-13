import path from "node:path";
import { promises as fs } from "node:fs";
import { ARTIFACT_FILE_NAMES, CALL_DIR_PREFIX, IDEA_REFINEMENT_DIR_NAME, LOOP_DIR_PREFIX } from "./types.ts";

export interface CallWorkspace {
	baseDir: string;
	callDir: string;
	logsDir: string;
	loopsDir: string;
	rootFiles: {
		idea: string;
		directive: string;
		learning: string;
		criteria: string;
		diagnosis: string;
		metrics: string;
		backlog: string;
		response: string;
		feedback: string;
		manifest: string;
		report: string;
		checklist: string;
	};
	/** D7 fix: Pre-computed relative paths to avoid repeated path.relative calls in prompt builders. */
	relativePaths: {
		idea: string;
		directive: string;
		learning: string;
		criteria: string;
		diagnosis: string;
		metrics: string;
		backlog: string;
		response: string;
		feedback: string;
		report: string;
		checklist: string;
	};
}

export const DEFAULT_CALL_WORKSPACE_ALLOCATION_MAX_ATTEMPTS = 256;

export function formatCallNumber(callNumber: number): string {
	return String(callNumber).padStart(2, "0");
}

export function formatLoopNumber(loopNumber: number): string {
	return String(loopNumber).padStart(2, "0");
}

export function getCallDirectoryName(callNumber: number): string {
	return `${CALL_DIR_PREFIX}${formatCallNumber(callNumber)}`;
}

export function getLoopDirectoryName(loopNumber: number): string {
	return `${LOOP_DIR_PREFIX}${formatLoopNumber(loopNumber)}`;
}

export function toProjectRelativePath(cwd: string, targetPath: string): string {
	const relative = path.relative(cwd, targetPath);
	if (!relative || relative === "") return ".";
	return relative.split(path.sep).join("/");
}

export async function ensureIdeaRefinementBase(cwd: string): Promise<string> {
	const baseDir = path.join(cwd, "docs", IDEA_REFINEMENT_DIR_NAME);
	await fs.mkdir(baseDir, { recursive: true });
	return baseDir;
}

export async function findNextCallNumber(baseDir: string): Promise<number> {
	let highest = 0;

	try {
		const entries = await fs.readdir(baseDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const match = entry.name.match(/^artifacts_call_(\d+)$/);
			if (!match) continue;
			highest = Math.max(highest, Number.parseInt(match[1] ?? "0", 10));
		}
	} catch {
		return 1;
	}

	return highest + 1;
}

function buildWorkspace(cwd: string, baseDir: string, callNumber: number): CallWorkspace {
	const callDir = path.join(baseDir, getCallDirectoryName(callNumber));
	const logsDir = path.join(callDir, "logs");
	const loopsDir = path.join(callDir, "loops");

	const rootFiles = {
		idea: path.join(callDir, ARTIFACT_FILE_NAMES.idea),
		directive: path.join(callDir, ARTIFACT_FILE_NAMES.directive),
		learning: path.join(callDir, ARTIFACT_FILE_NAMES.learning),
		criteria: path.join(callDir, ARTIFACT_FILE_NAMES.criteria),
		diagnosis: path.join(callDir, ARTIFACT_FILE_NAMES.diagnosis),
		metrics: path.join(callDir, ARTIFACT_FILE_NAMES.metrics),
		backlog: path.join(callDir, ARTIFACT_FILE_NAMES.backlog),
		response: path.join(callDir, ARTIFACT_FILE_NAMES.response),
		feedback: path.join(callDir, ARTIFACT_FILE_NAMES.feedback),
		manifest: path.join(callDir, ARTIFACT_FILE_NAMES.manifest),
		report: path.join(callDir, ARTIFACT_FILE_NAMES.report),
		checklist: path.join(callDir, ARTIFACT_FILE_NAMES.checklist),
	};

	// D7 fix: Pre-compute relative paths once at workspace creation
	const relativePaths = {
		idea: toProjectRelativePath(cwd, rootFiles.idea),
		directive: toProjectRelativePath(cwd, rootFiles.directive),
		learning: toProjectRelativePath(cwd, rootFiles.learning),
		criteria: toProjectRelativePath(cwd, rootFiles.criteria),
		diagnosis: toProjectRelativePath(cwd, rootFiles.diagnosis),
		metrics: toProjectRelativePath(cwd, rootFiles.metrics),
		backlog: toProjectRelativePath(cwd, rootFiles.backlog),
		response: toProjectRelativePath(cwd, rootFiles.response),
		feedback: toProjectRelativePath(cwd, rootFiles.feedback),
		report: toProjectRelativePath(cwd, rootFiles.report),
		checklist: toProjectRelativePath(cwd, rootFiles.checklist),
	};

	return {
		baseDir,
		callDir,
		logsDir,
		loopsDir,
		rootFiles,
		relativePaths,
	};
}

async function initializeWorkspaceDirectories(workspace: CallWorkspace): Promise<void> {
	await fs.mkdir(workspace.logsDir, { recursive: true });
	await fs.mkdir(workspace.loopsDir, { recursive: true });
}

async function tryAllocateWorkspaceRange(cwd: string, baseDir: string, startCallNumber: number, maxAttempts: number): Promise<{ callNumber: number; workspace: CallWorkspace } | undefined> {
	for (let offset = 0; offset < maxAttempts; offset += 1) {
		const callNumber = startCallNumber + offset;
		const workspace = buildWorkspace(cwd, baseDir, callNumber);
		try {
			await fs.mkdir(workspace.callDir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		await initializeWorkspaceDirectories(workspace);
		return { callNumber, workspace };
	}
	return undefined;
}

export async function allocateCallWorkspace(
	cwd: string,
	options: { startCallNumber?: number; maxAttempts?: number } = {},
): Promise<{ callNumber: number; workspace: CallWorkspace }> {
	const baseDir = await ensureIdeaRefinementBase(cwd);
	const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_CALL_WORKSPACE_ALLOCATION_MAX_ATTEMPTS);
	const hintedStartCallNumber = Math.max(1, options.startCallNumber ?? await findNextCallNumber(baseDir));

	const hintedAllocation = await tryAllocateWorkspaceRange(cwd, baseDir, hintedStartCallNumber, maxAttempts);
	if (hintedAllocation) return hintedAllocation;

	if (options.startCallNumber === undefined && hintedStartCallNumber > 1) {
		const gapFallbackAttempts = hintedStartCallNumber - 1;
		const gapFallbackAllocation = await tryAllocateWorkspaceRange(cwd, baseDir, 1, gapFallbackAttempts);
		if (gapFallbackAllocation) return gapFallbackAllocation;
	}

	throw new Error(`Failed to allocate a unique call workspace after ${maxAttempts} attempts from hint ${hintedStartCallNumber} in ${baseDir}`);
}

export async function prepareCallWorkspace(cwd: string, callNumber: number): Promise<CallWorkspace> {
	const baseDir = await ensureIdeaRefinementBase(cwd);
	const workspace = buildWorkspace(cwd, baseDir, callNumber);
	await initializeWorkspaceDirectories(workspace);
	return workspace;
}

export async function ensureLoopDirectory(workspace: CallWorkspace, loopNumber: number): Promise<string> {
	const loopDir = path.join(workspace.loopsDir, getLoopDirectoryName(loopNumber));
	await fs.mkdir(loopDir, { recursive: true });
	return loopDir;
}
