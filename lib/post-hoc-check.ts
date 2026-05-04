/**
 * post-hoc-check.ts — SHA256 snapshot of the source-code directory
 *
 * Purpose: Detect whether a "develop" loop actually changed .ts files
 * in the extension directory, providing material evidence of execution
 * vs. pseudo-execution.
 *
 * Mechanism:
 * 1. Before develop: take SHA256 snapshot of all .ts files in the directory
 * 2. After develop: take a new snapshot and compare
 * 3. Returns list of changed files (or empty if none)
 *
 * This feeds criterion C7 (Material Execution) of FEEDBACK.md.
 */

import { createHash } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

export interface FileSnapshot {
	[relativePath: string]: string; // SHA256 hex digest
}

export interface SnapshotDiff {
	changed: string[];       // files with different hash
	added: string[];         // new files
	removed: string[];       // files that disappeared
	hasChanges: boolean;     // true if changed + added + removed > 0
}

export interface TakeSnapshotOptions {
	scope?: string[];
	maxDepth?: number;
	maxFiles?: number;
}

/**
 * Takes a SHA256 snapshot of .ts files in the extension root directory.
 * Returns a map of relative path → hash.
 * If the directory does not exist, returns an empty object.
 */
export async function takeSnapshot(extensionRoot: string, options?: TakeSnapshotOptions): Promise<FileSnapshot> {
	const snapshot: FileSnapshot = {};
	const { scope, maxDepth = Infinity, maxFiles = Infinity } = options ?? {};

	try {
		await fs.access(extensionRoot);
	} catch {
		return snapshot;
	}

	let fileCount = 0;
	let depthExceeded = false;
	let filesExceeded = false;

	async function walkDir(dir: string, depth: number): Promise<void> {
		if (depth > maxDepth) {
			depthExceeded = true;
			return;
		}
		if (fileCount >= maxFiles) {
			filesExceeded = true;
			return;
		}

		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (fileCount >= maxFiles) {
				filesExceeded = true;
				return;
			}
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
				await walkDir(fullPath, depth + 1);
			} else if (entry.isFile() && entry.name.endsWith(".ts")) {
				const relPath = path.relative(extensionRoot, fullPath);
				try {
					const content = await fs.readFile(fullPath, "utf-8");
					snapshot[relPath] = createHash("sha256").update(content, "utf-8").digest("hex");
					fileCount++;
				} catch {
					// skip unreadable files
				}
			}
		}
	}

	const roots = scope && scope.length > 0
		? scope.map((s) => path.resolve(extensionRoot, s))
		: [extensionRoot];

	for (const root of roots) {
		await walkDir(root, 0);
	}

	if (depthExceeded || filesExceeded) {
		console.warn(`[idea-refinement] Snapshot truncated: depthExceeded=${depthExceeded}, filesExceeded=${filesExceeded}, maxDepth=${maxDepth}, maxFiles=${maxFiles}`);
	}

	return snapshot;
}

/**
 * Compares two snapshots and returns the differences.
 */
export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): SnapshotDiff {
	const changed: string[] = [];
	const added: string[] = [];
	const removed: string[] = [];

	const allFiles = new Set([...Object.keys(before), ...Object.keys(after)]);

	for (const file of allFiles) {
		const beforeHash = before[file];
		const afterHash = after[file];

		if (beforeHash && !afterHash) {
			removed.push(file);
		} else if (!beforeHash && afterHash) {
			added.push(file);
		} else if (beforeHash && afterHash && beforeHash !== afterHash) {
			changed.push(file);
		}
	}

	return {
		changed,
		added,
		removed,
		hasChanges: changed.length > 0 || added.length > 0 || removed.length > 0,
	};
}

/**
 * Formats the diff for inclusion in a notification or diagnosis.
 */
export function formatSnapshotDiff(diff: SnapshotDiff): string {
	const parts: string[] = [];

	if (diff.changed.length > 0) {
		parts.push(`changed (${diff.changed.length}): ${diff.changed.join(", ")}`);
	}
	if (diff.added.length > 0) {
		parts.push(`added (${diff.added.length}): ${diff.added.join(", ")}`);
	}
	if (diff.removed.length > 0) {
		parts.push(`removed (${diff.removed.length}): ${diff.removed.join(", ")}`);
	}

	if (parts.length === 0) {
		return "No material changes detected in source code.";
	}

	return parts.join("; ");
}
