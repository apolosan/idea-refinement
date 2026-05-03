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
}

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

export async function prepareCallWorkspace(cwd: string, callNumber: number): Promise<CallWorkspace> {
	const baseDir = await ensureIdeaRefinementBase(cwd);
	const callDir = path.join(baseDir, getCallDirectoryName(callNumber));
	const logsDir = path.join(callDir, "logs");
	const loopsDir = path.join(callDir, "loops");

	await fs.mkdir(logsDir, { recursive: true });
	await fs.mkdir(loopsDir, { recursive: true });

	return {
		baseDir,
		callDir,
		logsDir,
		loopsDir,
		rootFiles: {
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
		},
	};
}

export async function ensureLoopDirectory(workspace: CallWorkspace, loopNumber: number): Promise<string> {
	const loopDir = path.join(workspace.loopsDir, getLoopDirectoryName(loopNumber));
	// O2 fix: Create logs/ subdirectory inside each loop directory
	const loopLogsDir = path.join(loopDir, "logs");
	await fs.mkdir(loopLogsDir, { recursive: true });
	await fs.mkdir(loopDir, { recursive: true });
	return loopDir;
}
