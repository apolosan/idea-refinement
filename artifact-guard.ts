import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { isToolCallEventType, type ExtensionAPI, type ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { findContainingRoot, parseProtectedRoots, PROTECTED_ROOTS_ENV } from "./lib/path-guards.ts";
import { terminalStateCache } from "./lib/terminal-state-cache.ts";

const SUBPROCESS_ALLOWED_TOOLS = ["read", "bash", "edit"];
const ALLOWED_BASH_COMMANDS = new Set(["ls", "tree"]);
const BASH_DISALLOWED_PATTERN = /[;&|><`$()\n\r]/;
const GUARD_AUDIT_LOG_BASENAME = "guard-denials.jsonl";
const GUARD_AUDIT_MAX_PREVIEW = 280;

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

function truncate(value: string, maxLength = GUARD_AUDIT_MAX_PREVIEW): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function summarizeToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
	switch (toolName) {
		case "read":
			return {
				path: typeof input.path === "string" ? truncate(input.path) : undefined,
				offset: typeof input.offset === "number" ? input.offset : undefined,
				limit: typeof input.limit === "number" ? input.limit : undefined,
			};
		case "bash":
			return {
				command: typeof input.command === "string" ? truncate(input.command) : undefined,
			};
		case "edit":
			return {
				path: typeof input.path === "string" ? truncate(input.path) : undefined,
				edits: Array.isArray(input.edits) ? input.edits.length : undefined,
			};
		default:
			return {};
	}
}

function getAuditLogPath(root: string): string {
	return path.join(root, "logs", GUARD_AUDIT_LOG_BASENAME);
}

function resolveAuditRoot(options: {
	protectedRoots: string[];
	cwd: string;
	targetPath?: string;
}): string | undefined {
	const { protectedRoots, cwd, targetPath } = options;
	if (targetPath) {
		const containingRoot = findContainingRoot(targetPath, cwd, protectedRoots);
		if (containingRoot) return containingRoot;
	}
	return protectedRoots[0];
}

async function persistDeniedAttempt(options: {
	protectedRoots: string[];
	cwd: string;
	toolName: string;
	input: Record<string, unknown>;
	reason: string;
	targetPath?: string;
}): Promise<void> {
	const auditRoot = resolveAuditRoot({
		protectedRoots: options.protectedRoots,
		cwd: options.cwd,
		targetPath: options.targetPath,
	});
	if (!auditRoot) return;

	const auditLogPath = getAuditLogPath(auditRoot);
	const entry = {
		timestamp: new Date().toISOString(),
		decision: "blocked",
		toolName: options.toolName,
		cwd: options.cwd,
		targetPath: options.targetPath,
		reason: options.reason,
		input: summarizeToolInput(options.toolName, options.input),
	};

	try {
		await mkdir(path.dirname(auditLogPath), { recursive: true });
		await appendFile(auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
	} catch (error) {
		console.error("[idea-refinement] failed to persist guard denial audit record:", error);
	}
}

async function blockWithAudit(options: {
	protectedRoots: string[];
	cwd: string;
	toolName: string;
	input: Record<string, unknown>;
	reason: string;
	targetPath?: string;
}): Promise<{ block: true; reason: string }> {
	await persistDeniedAttempt(options);
	return {
		block: true,
		reason: options.reason,
	};
}

function parseBashInspectionCommand(command: string): { binary: string; targetPath: string } | undefined {
	const trimmed = command.trim();
	if (!trimmed) return undefined;
	if (BASH_DISALLOWED_PATTERN.test(trimmed)) return undefined;
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	if (tokens.length !== 2) return undefined;
	const [binary, targetPath] = tokens;
	if (!ALLOWED_BASH_COMMANDS.has(binary ?? "")) return undefined;
	if (!targetPath || targetPath.startsWith("-")) return undefined;
	return { binary, targetPath };
}

export default function artifactGuardExtension(pi: ExtensionAPI) {
	const protectedRoots = parseProtectedRoots(process.env[PROTECTED_ROOTS_ENV]);
	if (protectedRoots.length === 0) return;

	pi.on("session_start", async () => {
		pi.setActiveTools(SUBPROCESS_ALLOWED_TOOLS);
	});

	pi.on("tool_call", async (event: ToolCallEvent<string>, ctx: { cwd: string }) => {
		if (isToolCallEventType("write", event)) {
			return blockWithAudit({
				protectedRoots,
				cwd: ctx.cwd,
				toolName: event.toolName,
				input: event.input,
				reason: "Direct write is disabled for idea-refinement subprocess agents. The parent extension persists artifacts by code.",
				targetPath: typeof event.input.path === "string" ? event.input.path : undefined,
			});
		}

		if (!SUBPROCESS_ALLOWED_TOOLS.includes(event.toolName)) {
			return blockWithAudit({
				protectedRoots,
				cwd: ctx.cwd,
				toolName: event.toolName,
				input: event.input,
				reason: `Tool ${event.toolName} is disabled for idea-refinement subprocess agents. Allowed tools: ${SUBPROCESS_ALLOWED_TOOLS.join(", ")}.`,
			});
		}

		if (isToolCallEventType("read", event)) {
			const targetPath = typeof event.input.path === "string" ? event.input.path : undefined;
			if (!targetPath) {
				return blockWithAudit({
					protectedRoots,
					cwd: ctx.cwd,
					toolName: event.toolName,
					input: event.input,
					reason: "Read requires a valid path.",
				});
			}
			if (isPathInside(ctx.cwd, targetPath, ctx.cwd)) return;
			return blockWithAudit({
				protectedRoots,
				cwd: ctx.cwd,
				toolName: event.toolName,
				input: event.input,
				targetPath,
				reason: `Read is restricted to the current project scope (${ctx.cwd}).`,
			});
		}

		if (isToolCallEventType("bash", event)) {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			const parsedCommand = parseBashInspectionCommand(command);
			if (!parsedCommand) {
				return blockWithAudit({
					protectedRoots,
					cwd: ctx.cwd,
					toolName: event.toolName,
					input: event.input,
					reason: "Only simple ls/tree commands with a single relative target path inside the active call are allowed.",
				});
			}
			if (path.isAbsolute(parsedCommand.targetPath)) {
				return blockWithAudit({
					protectedRoots,
					cwd: ctx.cwd,
					toolName: event.toolName,
					input: event.input,
					targetPath: parsedCommand.targetPath,
					reason: "Absolute-path ls/tree commands are not allowed for idea-refinement subprocess agents.",
				});
			}
			const allowed = protectedRoots.some((root) => isPathInside(root, parsedCommand.targetPath, ctx.cwd));
			if (allowed) return;
			return blockWithAudit({
				protectedRoots,
				cwd: ctx.cwd,
				toolName: event.toolName,
				input: event.input,
				targetPath: parsedCommand.targetPath,
				reason: "Directory inspection is restricted to relative paths inside the active call workspace.",
			});
		}

		if (isToolCallEventType("edit", event)) {
			const targetPath = typeof event.input.path === "string" ? event.input.path : undefined;
			if (!targetPath) {
				return blockWithAudit({
					protectedRoots,
					cwd: ctx.cwd,
					toolName: event.toolName,
					input: event.input,
					reason: "Edit requires a valid path.",
				});
			}

			const containingRoot = findContainingRoot(targetPath, ctx.cwd, protectedRoots);
			if (!containingRoot) {
				return blockWithAudit({
					protectedRoots,
					cwd: ctx.cwd,
					toolName: event.toolName,
					input: event.input,
					targetPath,
					reason: "Edit is restricted to active-call artifacts inside the protected workspace.",
				});
			}

			if (isRootInTerminalState(containingRoot)) {
				return;
			}
			return blockWithAudit({
				protectedRoots,
				cwd: ctx.cwd,
				toolName: event.toolName,
				input: event.input,
				targetPath,
				reason: `Artifact path is protected by the active idea-refinement workflow: ${targetPath}`,
			});
		}
	});
}
