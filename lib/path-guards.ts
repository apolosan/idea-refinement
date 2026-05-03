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

export function isPathInsideRoots(targetPath: string, cwd: string, roots: string[]): boolean {
	const resolvedTarget = path.resolve(cwd, targetPath);

	return roots.some((root) => {
		const resolvedRoot = path.resolve(root);
		return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
	});
}
