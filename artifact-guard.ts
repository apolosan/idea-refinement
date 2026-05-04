import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isToolCallEventType, type ExtensionAPI, type ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { isPathInsideRoots, parseProtectedRoots, PROTECTED_ROOTS_ENV } from "./lib/path-guards.ts";
import { terminalStateCache } from "./lib/terminal-state-cache.ts";

/**
 * R1 fix: Checks if a specific root's workflow manifest is in a terminal state.
 * Only allows writes to roots whose own workflow has completed.
 *
 * P0 fix: Consults an in-memory cache before hitting the file system,
 * reducing per-tool-call blocking to sub-millisecond on cache hits.
 */
function isRootInTerminalState(root: string): boolean {
	if (terminalStateCache.has(root)) return true;

	const manifestPath = path.join(root, "run.json");
	if (!existsSync(manifestPath)) return false;
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		if (manifest.status === "success" || manifest.status === "failed") {
			terminalStateCache.add(root);
			return true;
		}
		terminalStateCache.delete(root);
		return false;
	} catch {
		return false;
	}
}

/**
 * Finds which protected root contains the target path.
 * Returns undefined if the path is not inside any protected root.
 */
function findContainingRoot(targetPath: string, cwd: string, roots: string[]): string | undefined {
	const resolvedTarget = path.resolve(cwd, targetPath);
	return roots.find((root) => {
		const resolvedRoot = path.resolve(root);
		return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
	});
}

export default function artifactGuardExtension(pi: ExtensionAPI) {
	const protectedRoots = parseProtectedRoots(process.env[PROTECTED_ROOTS_ENV]);
	if (protectedRoots.length === 0) return;

	pi.on("tool_call", async (event: ToolCallEvent<"write"> | ToolCallEvent<"edit">, ctx: { cwd: string }) => {
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const targetPath = typeof event.input.path === "string" ? event.input.path : undefined;
			if (!targetPath) return;
			// R1 fix: Find which specific root contains this path
			const containingRoot = findContainingRoot(targetPath, ctx.cwd, protectedRoots);
			if (containingRoot) {
				// Only allow writes if THIS specific root's workflow is terminal
				if (isRootInTerminalState(containingRoot)) {
					return;
				}
				return {
					block: true,
					reason: `Artifact path is protected by the idea refinement workflow: ${targetPath}`,
				};
			}
		}
	});
}
