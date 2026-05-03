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

function aggregateUsage(target: StageUsage, message: any): void {
	const usage = message?.usage;
	if (!usage) return;
	target.turns += 1;
	target.input += usage.input ?? 0;
	target.output += usage.output ?? 0;
	target.cacheRead += usage.cacheRead ?? 0;
	target.cacheWrite += usage.cacheWrite ?? 0;
	target.cost += usage.cost?.total ?? 0;
	target.contextTokens = usage.totalTokens ?? target.contextTokens;
}

function summarizeAssistantMessage(message: any): AssistantMessageSummary {
	const text = Array.isArray(message?.content)
		? message.content
				.filter((part: any) => part?.type === "text")
				.map((part: any) => part.text)
				.join("\n")
		: undefined;

	return {
		text,
		stopReason: typeof message?.stopReason === "string" ? message.stopReason : undefined,
		errorMessage: typeof message?.errorMessage === "string" ? message.errorMessage : undefined,
		model: typeof message?.model === "string" ? message.model : undefined,
	};
}

async function writeTempSystemPrompt(systemPrompt: string): Promise<{ dir: string; filePath: string }> {
	const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-idea-refinement-"));
	const filePath = path.join(tempDir, "system-prompt.md");
	await fsp.writeFile(filePath, systemPrompt, "utf8");
	return { dir: tempDir, filePath };
}

export function buildPiArgs(options: { tempPromptPath: string; userPrompt: string; model?: string; thinkingLevel?: string; cwd?: string }): string[] {
	const { tempPromptPath, userPrompt, model, thinkingLevel, cwd } = options;
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
	args.push(userPrompt);
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

function safeParseJson(line: string): any | undefined {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

// O6 fix: Remove "error" from stdout filter — errors come via stderr
function shouldPersistStdoutLogLine(line: string): boolean {
	if (line.length === 0) return false;
	if (line.includes('"type":"message_update"')) return false;
	return (
		line.includes('"type":"session"') ||
		line.includes('"type":"agent_start"') ||
		line.includes('"type":"turn_start"') ||
		line.includes('"type":"turn_end"') ||
		line.includes('"type":"message_start"') ||
		line.includes('"type":"message_end"') ||
		line.includes('"type":"tool_execution_start"') ||
		line.includes('"type":"tool_execution_end"')
	);
}

// O8 fix: Simplified JSON string extraction using regex
function extractJsonStringValueAfter(line: string, anchor: string, fieldName: string): string | undefined {
	const anchorIndex = line.indexOf(anchor);
	if (anchorIndex === -1) return undefined;

	const token = `"${fieldName}":"`;
	const match = line.slice(anchorIndex).match(new RegExp(`${token}(.*?)(?:"[,}]|$)`));
	if (!match) return undefined;

	const rawValue = match[1] ?? "";
	if (!rawValue.includes("\\")) return rawValue;

	try {
		return JSON.parse(`"${rawValue}"`);
	} catch {
		return undefined;
	}
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
	logPath: string;
	stderrPath: string;
	protectedRoots: string[];
	onProgress?: (message: string) => void;
	onEvent?: (event: PiStageStreamEvent) => void;
	/** D3 fix: Timeout in ms. Default: 10 minutes. Set to 0 to disable. */
	timeoutMs?: number;
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
	const { cwd, model, thinkingLevel, systemPrompt, userPrompt, logPath, stderrPath, protectedRoots, onProgress, onEvent } = options;
	// D3 fix: Default timeout of 10 minutes. Set to 0 to disable.
	const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
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

	emitProgress("Aguardando resposta do agente...", true);

	try {
		const args = buildPiArgs({
			tempPromptPath: tempPrompt.filePath,
			userPrompt,
			model,
			thinkingLevel,
			cwd,
		});

		const invocation = options.invocation
			? { command: options.invocation.command, args: [...(options.invocation.args ?? []), ...args] }
			: getPiInvocation(args);

		const exitCode = await new Promise<number>((resolve, reject) => {
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					[PROTECTED_ROOTS_ENV]: JSON.stringify(protectedRoots),
				},
			});

			// D3 fix: Timeout handling
			let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
			if (timeoutMs > 0) {
				timeoutTimer = setTimeout(() => {
					try { proc.kill("SIGTERM"); } catch {}
					reject(new Error(`Stage timed out after ${timeoutMs}ms`));
				}, timeoutMs);
			}

			// D4 fix: Propagate SIGTERM/SIGINT to subprocess
			const onParentSignal = () => {
				try { proc.kill("SIGTERM"); } catch {}
			};
			process.once("SIGTERM", onParentSignal);
			process.once("SIGINT", onParentSignal);

			const cleanup = () => {
				if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = undefined; }
				process.off("SIGTERM", onParentSignal);
				process.off("SIGINT", onParentSignal);
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

				if (line.includes('"type":"tool_execution_start"')) {
					const event = safeParseJson(line);
					const toolName = typeof event?.toolName === "string" ? event.toolName : "ferramenta";
					emitProgress(`Executando ferramenta ${toolName}...`);
					emitEvent({ type: "tool_execution_start", toolName, args: event?.args });
					return;
				}

				if (line.includes('"type":"tool_execution_end"')) {
					const toolName = extractJsonStringValueAfter(line, '"type":"tool_execution_end"', "toolName") ?? "ferramenta";
					const isError = line.includes('"isError":true');
					emitProgress(isError ? `Ferramenta ${toolName} retornou erro.` : `Ferramenta ${toolName} concluída.`);
					emitEvent({ type: "tool_execution_end", toolName, isError });
					return;
				}

				if (line.includes('"type":"message_update"')) {
					if (line.includes('"assistantMessageEvent":{"type":"thinking_start"')) {
						emitProgress("Analisando instruções...");
						return;
					}

					if (line.includes('"assistantMessageEvent":{"type":"text_start"')) {
						emitProgress("Redigindo resposta...");
						emitEvent({ type: "text_start" });
						return;
					}

					if (line.includes('"assistantMessageEvent":{"type":"text_end"')) {
						emitProgress("Finalizando resposta...");
						emitEvent({ type: "text_end" });
						return;
					}
				}

				if (!line.includes('"type":"message_end"') || !line.includes('"role":"assistant"')) {
					return;
				}

				const event = safeParseJson(line);
				if (event?.type !== "message_end" || event.message?.role !== "assistant") {
					return;
				}

				lastAssistant = summarizeAssistantMessage(event.message);
				aggregateUsage(usage, event.message);
				emitEvent({
					type: "message_end",
					text: lastAssistant.text,
					model: lastAssistant.model,
					stopReason: lastAssistant.stopReason,
					errorMessage: lastAssistant.errorMessage,
				});
				emitProgress(lastAssistant.text ? "Resposta recebida, validando saída..." : "Turno concluído, aguardando próximo passo...", true);
			};

			proc.stdout.on("data", (chunk) => {
				buffer += stdoutDecoder.write(chunk);
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					writeStdoutLogLine(line);
					processLine(line);
				}
			});

			proc.stderr.on("data", (chunk) => {
				stderrLogStream.write(chunk);
				stderrTail = appendTail(stderrTail, stderrDecoder.write(chunk), STDERR_TAIL_LIMIT);
			});

			proc.on("error", (error) => { cleanup(); reject(error); });
			proc.on("close", (code) => {
				cleanup();
				buffer += stdoutDecoder.end();
				if (buffer.trim().length > 0) {
					const finalLine = buffer.trimEnd();
					writeStdoutLogLine(finalLine);
					processLine(finalLine);
				}
				stderrTail = appendTail(stderrTail, stderrDecoder.end(), STDERR_TAIL_LIMIT);
				resolve(code ?? 0);
			});
		});

		await Promise.all([finalizeWriteStream(stdoutLogStream), finalizeWriteStream(stderrLogStream)]);

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
		} catch {
			stdoutLogStream.destroy();
			stderrLogStream.destroy();
		}
		try {
			await fsp.unlink(tempPrompt.filePath);
		} catch {
			// Ignore cleanup errors.
		}
		try {
			await fsp.rmdir(tempPrompt.dir);
		} catch {
			// Ignore cleanup errors.
		}
	}
}
