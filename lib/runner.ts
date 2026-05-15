import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { PROTECTED_ROOTS_ENV } from "./path-guards.ts";
import type { PiStageStreamEvent, StageExecutionResult, StageUsage } from "./types.ts";
import { normalizeMarkdown } from "./io.ts";
import type { ControlledStageProcessHandle, WorkflowRuntimeControl } from "./workflow-runtime-control.ts";
const STDERR_TAIL_LIMIT = 32_768;

/**
 * Resolves the guard extension path dynamically to avoid ESM/CommonJS issues
 * at module initialization time.
 */
function resolveGuardExtensionPath(): string {
	// Resolve from the package directory (works when installed as npm package)
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const packageGuardPath = path.resolve(__dirname, "..", "artifact-guard.ts");
	if (fs.existsSync(packageGuardPath)) {
		return packageGuardPath;
	}

	// Fallback: try cwd for local development / backward compatibility
	const cwdPath = path.resolve(process.cwd(), "artifact-guard.ts");
	if (fs.existsSync(cwdPath)) {
		return cwdPath;
	}

	return packageGuardPath;
}

const GUARD_EXTENSION_PATH = resolveGuardExtensionPath();

interface AssistantMessageSummary {
	text?: string;
	stopReason?: string;
	errorMessage?: string;
	model?: string;
}

function zeroUsage(): StageUsage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		turns: 0,
		contextTokens: 0,
	};
}

interface PiMessagePart {
	type?: string;
	text?: string;
}

interface PiMessageCost {
	total?: number;
}

interface PiMessageUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: PiMessageCost;
}

interface PiMessage {
	content?: unknown;
	stopReason?: string;
	errorMessage?: string;
	model?: string;
	usage?: PiMessageUsage;
}

function aggregateUsage(target: StageUsage, message: PiMessage): void {
	const usage = message.usage;
	if (!usage) return;
	target.turns += 1;
	target.input += usage.input ?? 0;
	target.output += usage.output ?? 0;
	target.cacheRead += usage.cacheRead ?? 0;
	target.cacheWrite += usage.cacheWrite ?? 0;
	target.cost += usage.cost?.total ?? 0;
	target.contextTokens = usage.totalTokens ?? target.contextTokens;
}

function summarizeAssistantMessage(message: PiMessage): AssistantMessageSummary {
	const text = Array.isArray(message.content)
		? (message.content as PiMessagePart[])
				.filter((part) => part?.type === "text")
				.map((part) => part.text)
				.filter((t): t is string => typeof t === "string")
				.join("\n")
		: undefined;

	return {
		text,
		stopReason: typeof message.stopReason === "string" ? message.stopReason : undefined,
		errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : undefined,
		model: typeof message.model === "string" ? message.model : undefined,
	};
}

async function writeTempSystemPrompt(systemPrompt: string): Promise<{ dir: string; filePath: string }> {
	const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-idea-refinement-"));
	await fsp.chmod(tempDir, 0o700);
	const filePath = path.join(tempDir, "system-prompt.md");
	await fsp.writeFile(filePath, systemPrompt, "utf8");
	return { dir: tempDir, filePath };
}

export type UserPromptTransport = "argv" | "stdin";

const STDIN_USER_PROMPT_PREAMBLE = "Use the piped stdin content as the primary user prompt.";

export function buildPiArgs(options: {
	tempPromptPath: string;
	userPrompt: string;
	model?: string;
	thinkingLevel?: string;
	userPromptTransport?: UserPromptTransport;
}): string[] {
	const { tempPromptPath, userPrompt, model, thinkingLevel, userPromptTransport = "argv" } = options;
	const args = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
		"--extension",
		GUARD_EXTENSION_PATH,
		"--append-system-prompt",
		tempPromptPath,
	];
	if (model) args.push("--model", model);
	if (thinkingLevel) args.push("--thinking", thinkingLevel);
	args.push(userPromptTransport === "stdin" ? STDIN_USER_PROMPT_PREAMBLE : userPrompt);
	return args;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		// C5 fix: propagate process.execArgv (e.g. --experimental-strip-types) to subprocess
		return { command: process.execPath, args: [...process.execArgv, currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

function appendTail(current: string, next: string, maxChars: number): string {
	if (next.length >= maxChars) {
		return next.slice(-maxChars);
	}
	const available = maxChars - next.length;
	if (current.length <= available) {
		return current + next;
	}
	return current.slice(-available) + next;
}

function safeParseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

function isPiEvent(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).type === "string";
}

// O6 fix: Remove "error" from stdout filter — errors come via stderr
const KEEP_RE = /"type":"(?:session|agent_start|turn_start|turn_end|message_start|message_end|tool_execution_start|tool_execution_end)"/

function shouldPersistStdoutLogLine(line: string): boolean {
	if (line.length === 0) return false;
	if (line.includes('"type":"message_update"')) return false;
	return KEEP_RE.test(line);
}


async function finalizeWriteStream(stream: fs.WriteStream): Promise<void> {
	if (stream.writableFinished || stream.destroyed) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const handleError = (error: Error) => {
			stream.off("finish", handleFinish);
			reject(error);
		};
		const handleFinish = () => {
			stream.off("error", handleError);
			resolve();
		};
		stream.once("error", handleError);
		stream.once("finish", handleFinish);
		stream.end();
	});
}

export interface RunPiStageOptions {
	cwd: string;
	model?: string;
	thinkingLevel?: string;
	systemPrompt: string;
	userPrompt: string;
	userPromptTransport?: UserPromptTransport;
	logPath: string;
	stderrPath: string;
	protectedRoots: string[];
	onProgress?: (message: string) => void;
	onEvent?: (event: PiStageStreamEvent) => void;
	/**
	 * If provided, every assistant message_end text is normalized and tested.
	 * When it returns true, the subprocess is terminated early and the stage succeeds
	 * with the captured text instead of waiting for the child process to exit naturally.
	 *
	 * This prevents bootstrap/evaluate stalls when Pi keeps looping after already
	 * producing a structurally valid final artifact payload.
	 */
	earlySuccessValidator?: (normalizedAssistantText: string) => boolean;
	/**
	 * Hard cap for non-empty assistant message_end payloads in a single stage.
	 * Prevents endless alternation such as “Analyzing instructions...” ↔
	 * “validating output...” when the subprocess loops instead of terminating.
	 * Default: 8.
	 */
	maxAssistantMessages?: number;
	/**
	 * Inactivity timeout in ms. Reset whenever the subprocess emits agent/tool progress.
	 * Default: 5 minutes. Set to 0 to disable.
	 */
	timeoutMs?: number;
	runtimeControl?: WorkflowRuntimeControl;
	/**
	 * Override the subprocess invocation.
	 * `command`: the executable to run.
	 * `args`: base args prepended to the standard buildPiArgs output.
	 * Standard args (--append-system-prompt, --model, user prompt, etc.) are always appended.
	 */
	invocation?: {
		command: string;
		args?: string[];
	};
}

export async function runPiStage(options: RunPiStageOptions): Promise<StageExecutionResult> {
	const {
		cwd,
		model,
		thinkingLevel,
		systemPrompt,
		userPrompt,
		userPromptTransport = "argv",
		logPath,
		stderrPath,
		protectedRoots,
		onProgress,
		onEvent,
		runtimeControl,
		earlySuccessValidator,
	} = options;
	// Inactivity timeout only. Reset on meaningful subprocess progress.
	const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
	const maxAssistantMessages = options.maxAssistantMessages ?? 8;
	const usage = zeroUsage();
	let lastAssistant: AssistantMessageSummary = {};
	let stderrTail = "";
	let lastProgressMessage: string | undefined;

	const tempPrompt = await writeTempSystemPrompt(systemPrompt);
	await fsp.mkdir(path.dirname(logPath), { recursive: true });
	await fsp.mkdir(path.dirname(stderrPath), { recursive: true });

	const stdoutLogStream = fs.createWriteStream(logPath, { flags: "w" });
	const stderrLogStream = fs.createWriteStream(stderrPath, { flags: "w" });

	const emitProgress = (message: string, force = false) => {
		if (!onProgress) return;
		if (!force && message === lastProgressMessage) return;
		lastProgressMessage = message;
		onProgress(message);
	};

	const emitEvent = (event: PiStageStreamEvent) => {
		onEvent?.(event);
	};

	emitProgress("Waiting for agent response...", true);

	try {
		const args = buildPiArgs({
			tempPromptPath: tempPrompt.filePath,
			userPrompt,
			model,
			thinkingLevel,
			userPromptTransport,
		});

		const invocation = options.invocation
			? { command: options.invocation.command, args: [...(options.invocation.args ?? []), ...args] }
			: getPiInvocation(args);

		runtimeControl?.ensureNotStopped();

		const exitCode = await new Promise<number>((resolve, reject) => {
			let settled = false;
			const settleResolve = (code: number) => {
				if (settled) return;
				settled = true;
				resolve(code);
			};
			const settleReject = (error: Error) => {
				if (settled) return;
				settled = true;
				reject(error);
			};

			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					[PROTECTED_ROOTS_ENV]: JSON.stringify(protectedRoots),
				},
			});

			proc.stdin.end(userPromptTransport === "stdin" ? userPrompt : "");

			let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
			let timeoutError: Error | undefined;
			let loopingError: Error | undefined;
			let stopKillTimer: ReturnType<typeof setTimeout> | undefined;
			let isPaused = false;
			let procStopped = false;
			let earlySuccessCaptured = false;
			let assistantMessageCount = 0;

			const stopProcess = (signal: NodeJS.Signals = "SIGTERM") => {
				if (procStopped) return;
				procStopped = true;
				try { proc.kill(signal); } catch {}
				if (signal !== "SIGKILL") {
					stopKillTimer = setTimeout(() => {
						try { proc.kill("SIGKILL"); } catch {}
					}, 2000);
				}
			};

			const clearInactivityTimer = () => {
				if (timeoutTimer) {
					clearTimeout(timeoutTimer);
					timeoutTimer = undefined;
				}
			};

			const resetInactivityTimer = () => {
				if (timeoutMs <= 0 || isPaused) return;
				clearInactivityTimer();
				timeoutTimer = setTimeout(() => {
					timeoutError = new Error(`Stage inactive for ${timeoutMs}ms`);
					stopProcess("SIGTERM");
					settleReject(timeoutError);
				}, timeoutMs);
			};

			const stageHandle: ControlledStageProcessHandle = {
				pause: () => {
					if (isPaused) return;
					isPaused = true;
					clearInactivityTimer();
					try { proc.kill("SIGSTOP"); } catch {}
				},
				resume: () => {
					if (!isPaused) return;
					isPaused = false;
					try { proc.kill("SIGCONT"); } catch {}
					resetInactivityTimer();
				},
				stop: () => {
					clearInactivityTimer();
					stopProcess("SIGTERM");
				},
			};

			runtimeControl?.attachProcess(stageHandle);
			if (runtimeControl?.isStopRequested()) {
				stageHandle.stop(runtimeControl.getStopReason());
			}

			resetInactivityTimer();

			// D4 fix: Propagate SIGTERM/SIGINT to subprocess
			const onParentSignal = () => {
				try { proc.kill("SIGTERM"); } catch {}
			};
			process.once("SIGTERM", onParentSignal);
			process.once("SIGINT", onParentSignal);

			const cleanup = () => {
				clearInactivityTimer();
				if (stopKillTimer) { clearTimeout(stopKillTimer); stopKillTimer = undefined; }
				process.off("SIGTERM", onParentSignal);
				process.off("SIGINT", onParentSignal);
				runtimeControl?.detachProcess(stageHandle);
			};

			const stdoutDecoder = new StringDecoder("utf8");
			const stderrDecoder = new StringDecoder("utf8");
			let buffer = "";

			const writeStdoutLogLine = (line: string) => {
				if (!shouldPersistStdoutLogLine(line)) return;
				stdoutLogStream.write(`${line}\n`);
			};

			const processLine = (line: string) => {
				if (line.length === 0) return;

				resetInactivityTimer();
				const parsed = safeParseJson(line);
				if (!isPiEvent(parsed)) return;
				if (earlySuccessCaptured || loopingError) return;

				if (parsed.type === "tool_execution_start") {
					const toolName = typeof parsed.toolName === "string" ? parsed.toolName : "tool";
					emitProgress(`Executing tool ${toolName}...`);
					emitEvent({ type: "tool_execution_start", toolName, args: parsed.args });
					return;
				}

				if (parsed.type === "tool_execution_end") {
					const toolName = typeof parsed.toolName === "string" ? parsed.toolName : "tool";
					const isError = parsed.isError === true;
					emitProgress(isError ? `Tool ${toolName} returned an error.` : `Tool ${toolName} completed.`);
					emitEvent({ type: "tool_execution_end", toolName, isError });
					return;
				}

				if (parsed.type === "message_update") {
					const assistantEvent = (parsed as Record<string, unknown>).assistantMessageEvent;
					if (isPiEvent(assistantEvent)) {
						if (assistantEvent.type === "thinking_start") {
							emitProgress("Analyzing instructions...");
							return;
						}
						if (assistantEvent.type === "text_start") {
							emitProgress("Drafting response...");
							emitEvent({ type: "text_start" });
							return;
						}
						if (assistantEvent.type === "text_end") {
							emitProgress("Finalizing response...");
							emitEvent({ type: "text_end" });
							return;
						}
					}
					return;
				}

				if (parsed.type !== "message_end") return;

				const msg = (parsed as Record<string, unknown>).message;
				if (typeof msg !== "object" || msg === null) return;
				const role = typeof (msg as Record<string, unknown>).role === "string" ? (msg as Record<string, unknown>).role : undefined;
				if (role !== "assistant") return;

				lastAssistant = summarizeAssistantMessage(msg as PiMessage);
				aggregateUsage(usage, msg as PiMessage);
				emitEvent({
					type: "message_end",
					text: lastAssistant.text,
					model: lastAssistant.model,
					stopReason: lastAssistant.stopReason,
					errorMessage: lastAssistant.errorMessage,
				});

				const normalizedAssistantText = lastAssistant.text ? normalizeMarkdown(lastAssistant.text) : "";
				if (normalizedAssistantText) {
					assistantMessageCount += 1;
				}

				emitProgress(lastAssistant.text ? "Response received, validating output..." : "Turn completed, waiting for next step...", true);

				if (normalizedAssistantText && earlySuccessValidator?.(normalizedAssistantText)) {
					earlySuccessCaptured = true;
					emitProgress("Valid output captured, finalizing stage...", true);
					stopProcess("SIGTERM");
					return;
				}

				if (normalizedAssistantText && assistantMessageCount >= maxAssistantMessages) {
					loopingError = new Error(
						`Stage produced ${assistantMessageCount} assistant responses without terminating; possible subprocess loop. Last stopReason: ${lastAssistant.stopReason ?? "unknown"}.`,
					);
					stopProcess("SIGTERM");
					return;
				}
			};

			proc.stdout.on("data", (chunk) => {
				resetInactivityTimer();
				buffer += stdoutDecoder.write(chunk);
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					writeStdoutLogLine(line);
					processLine(line);
				}
			});

			proc.stderr.on("data", (chunk) => {
				resetInactivityTimer();
				stderrLogStream.write(chunk);
				stderrTail = appendTail(stderrTail, stderrDecoder.write(chunk), STDERR_TAIL_LIMIT);
			});

			proc.on("error", (error) => { cleanup(); settleReject(timeoutError ?? loopingError ?? error); });
			proc.on("close", (code) => {
				cleanup();
				buffer += stdoutDecoder.end();
				if (buffer.trim().length > 0) {
					const finalLine = buffer.trimEnd();
					writeStdoutLogLine(finalLine);
					processLine(finalLine);
				}
				stderrTail = appendTail(stderrTail, stderrDecoder.end(), STDERR_TAIL_LIMIT);
				if (timeoutError) {
					settleReject(timeoutError);
					return;
				}
				if (loopingError) {
					settleReject(loopingError);
					return;
				}
				if (earlySuccessCaptured) {
					settleResolve(0);
					return;
				}
				// E4 fix: exitCode === null (SIGKILL/OOM) must be treated as failure
				settleResolve(code === null ? 1 : code);
			});
		});

		await Promise.all([finalizeWriteStream(stdoutLogStream), finalizeWriteStream(stderrLogStream)]);

		if (runtimeControl?.isStopRequested()) {
			throw new Error(runtimeControl.getStopReason());
		}

		const normalizedText = lastAssistant.text ? normalizeMarkdown(lastAssistant.text) : "";
		const isFailure = exitCode !== 0 || lastAssistant.stopReason === "error" || lastAssistant.stopReason === "aborted";

		if (isFailure) {
			const reason = lastAssistant.errorMessage || stderrTail.trim() || `pi subprocess failed with exit code ${exitCode}`;
			throw new Error(reason);
		}

		if (!normalizedText) {
			throw new Error("The stage finished without a final assistant text output.");
		}

		return {
			text: normalizedText,
			exitCode,
			stderr: stderrTail,
			model: lastAssistant.model ?? model,
			stopReason: lastAssistant.stopReason,
			errorMessage: lastAssistant.errorMessage,
			usage,
		};
	} finally {
		try {
			await Promise.all([finalizeWriteStream(stdoutLogStream), finalizeWriteStream(stderrLogStream)]);
		} catch (streamError) {
			console.debug("[idea-refinement] stream finalization cleanup error:", streamError);
			stdoutLogStream.destroy();
			stderrLogStream.destroy();
		}
		try {
			await fsp.unlink(tempPrompt.filePath);
		} catch (unlinkError) {
			console.debug("[idea-refinement] temp prompt cleanup error:", unlinkError);
		}
		try {
			await fsp.rmdir(tempPrompt.dir);
		} catch (rmdirError) {
			console.debug("[idea-refinement] temp dir cleanup error:", rmdirError);
		}
	}
}
