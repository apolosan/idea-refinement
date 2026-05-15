import { promises as fs } from "node:fs";
import path from "node:path";

export const PROTECTED_ROOTS_ENV = "PI_IDEA_REFINEMENT_PROTECTED_ROOTS";

export function parseProtectedRoots(value: string | undefined): string[] {
	if (!value) return [];

	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
	} catch {
		return [];
	}
}

export function resolveTargetPath(cwd: string, targetPath: string): string {
	return path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(cwd, targetPath);
}

export function isPathInsideDirectory(parentPath: string, candidatePath: string): boolean {
	const resolvedParent = path.resolve(parentPath);
	const resolvedCandidate = path.resolve(candidatePath);
	const relative = path.relative(resolvedParent, resolvedCandidate);
	return relative === "" || (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realpathIfExists(targetPath: string): Promise<string | undefined> {
	try {
		return await fs.realpath(targetPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function realpathExistingAncestor(targetPath: string): Promise<string | undefined> {
	let current = targetPath;
	while (true) {
		const resolved = await realpathIfExists(current);
		if (resolved) return resolved;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export async function isPathInsideDirectoryByRealPath(parentPath: string, candidatePath: string): Promise<boolean> {
	if (!isPathInsideDirectory(parentPath, candidatePath)) return false;

	const parentRealPath = await realpathExistingAncestor(path.resolve(parentPath));
	if (!parentRealPath) return false;

	const candidateRealPath = await realpathIfExists(path.resolve(candidatePath));
	if (candidateRealPath) return isPathInsideDirectory(parentRealPath, candidateRealPath);

	const candidateParentRealPath = await realpathExistingAncestor(path.dirname(path.resolve(candidatePath)));
	return candidateParentRealPath !== undefined && isPathInsideDirectory(parentRealPath, candidateParentRealPath);
}

/**
 * Finds which root lexically contains the target path.
 * Returns the containing root string, or undefined if not inside any root.
 */
export function findContainingRoot(targetPath: string, cwd: string, roots: string[]): string | undefined {
	const resolvedTarget = resolveTargetPath(cwd, targetPath);
	return roots.find((root) => isPathInsideDirectory(root, resolvedTarget));
}

export function isPathInsideRoots(targetPath: string, cwd: string, roots: string[]): boolean {
	return findContainingRoot(targetPath, cwd, roots) !== undefined;
}

export async function findContainingRootByRealPath(targetPath: string, cwd: string, roots: string[]): Promise<string | undefined> {
	const resolvedTarget = resolveTargetPath(cwd, targetPath);
	for (const root of roots) {
		if (await isPathInsideDirectoryByRealPath(root, resolvedTarget)) return root;
	}
	return undefined;
}

export async function isPathInsideRootsByRealPath(targetPath: string, cwd: string, roots: string[]): Promise<boolean> {
	return (await findContainingRootByRealPath(targetPath, cwd, roots)) !== undefined;
}
