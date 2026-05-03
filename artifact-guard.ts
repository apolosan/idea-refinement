import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isToolCallEventType, type ExtensionAPI, type ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { isPathInsideRoots, parseProtectedRoots, PROTECTED_ROOTS_ENV } from "./lib/path-guards.ts";

/**
 * Checks if a workflow manifest exists and is in a terminal state (success or failed).
 * If so, the artifact guard is relaxed to allow writes to protected paths.
 */
function isWorkflowInTerminalState(protectedRoots: string[]): boolean {
	for (const root of protectedRoots) {
		const manifestPath = path.join(root, "run.json");
		if (existsSync(manifestPath)) {
			try {
				const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
				if (manifest.status === "success" || manifest.status === "failed") {
					return true;
				}
			} catch {
				// If manifest can't be parsed, assume workflow is still running
			}
		}
	}
	return false;
}

export default function artifactGuardExtension(pi: ExtensionAPI) {
	const protectedRoots = parseProtectedRoots(process.env[PROTECTED_ROOTS_ENV]);
	if (protectedRoots.length === 0) return;

	pi.on("tool_call", async (event: ToolCallEvent<"write"> | ToolCallEvent<"edit">, ctx: { cwd: string }) => {
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const targetPath = typeof event.input.path === "string" ? event.input.path : undefined;
			if (!targetPath) return;
			if (isPathInsideRoots(targetPath, ctx.cwd, protectedRoots)) {
				// P2-1: Allow writes when workflow has completed (success or failed)
				if (isWorkflowInTerminalState(protectedRoots)) {
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
