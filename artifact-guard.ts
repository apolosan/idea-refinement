import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isToolCallEventType, type ExtensionAPI, type ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { findContainingRoot, parseProtectedRoots, PROTECTED_ROOTS_ENV } from "./lib/path-guards.ts";
import { terminalStateCache } from "./lib/terminal-state-cache.ts";

const SUBPROCESS_ALLOWED_TOOLS = ["read", "bash", "edit"];
const ALLOWED_BASH_COMMANDS = new Set(["ls", "tree"]);
const BASH_DISALLOWED_PATTERN = /[;&|><`$()\n\r]/;

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
		const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
		if (typeof raw !== "object" || raw === null || typeof raw.status !== "string") return false;
		const manifest = raw as { status: string };
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

function isPathInside(root: string, targetPath: string, cwd: string): boolean {
	const resolvedRoot = path.resolve(root);
	const resolvedTarget = path.resolve(cwd, targetPath);
	return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function getArtifactsBaseDir(cwd: string): string {
	return path.join(cwd, "docs", "idea_refinement");
}

function isAllowedBashCommand(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed) return false;
	if (BASH_DISALLOWED_PATTERN.test(trimmed)) return false;
	const [binary] = trimmed.split(/\s+/, 1);
	return ALLOWED_BASH_COMMANDS.has(binary ?? "");
}

export default function artifactGuardExtension(pi: ExtensionAPI) {
	const protectedRoots = parseProtectedRoots(process.env[PROTECTED_ROOTS_ENV]);
	if (protectedRoots.length === 0) return;

	pi.on("session_start", async () => {
		pi.setActiveTools(SUBPROCESS_ALLOWED_TOOLS);
	});

	pi.on("tool_call", async (event: ToolCallEvent<string>, ctx: { cwd: string }) => {
		if (isToolCallEventType("write", event)) {
			return {
				block: true,
				reason: "Direct write is disabled for idea-refinement subprocess agents. The parent extension persists artifacts by code.",
			};
		}

		if (!SUBPROCESS_ALLOWED_TOOLS.includes(event.toolName)) {
			return {
				block: true,
				reason: `Tool ${event.toolName} is disabled for idea-refinement subprocess agents. Allowed tools: ${SUBPROCESS_ALLOWED_TOOLS.join(", ")}.`,
			};
		}

		if (isToolCallEventType("read", event)) {
			return;
		}

		if (isToolCallEventType("bash", event)) {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (isAllowedBashCommand(command)) return;
			return {
				block: true,
				reason: "Only simple directory inspection commands are allowed in bash for idea-refinement subprocess agents: ls or tree.",
			};
		}

		if (isToolCallEventType("edit", event)) {
			const targetPath = typeof event.input.path === "string" ? event.input.path : undefined;
			if (!targetPath) {
				return {
					block: true,
					reason: "Edit requires a valid path.",
				};
			}

			const artifactsBaseDir = getArtifactsBaseDir(ctx.cwd);
			if (!isPathInside(artifactsBaseDir, targetPath, ctx.cwd)) {
				return {
					block: true,
					reason: `Edit is restricted to idea-refinement artifacts under ${artifactsBaseDir}.`,
				};
			}

			const containingRoot = findContainingRoot(targetPath, ctx.cwd, protectedRoots);
			if (containingRoot) {
				if (isRootInTerminalState(containingRoot)) {
					return;
				}
				return {
					block: true,
					reason: `Artifact path is protected by the idea refinement workflow: ${targetPath}`,
				};
			}

			return;
		}
	});
}
