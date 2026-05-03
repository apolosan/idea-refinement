import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
	applyIdeaRefinementProgressEvent,
	buildIdeaRefinementStatusLine,
	buildIdeaRefinementWidgetLines,
	createIdeaRefinementMonitorState,
	setIdeaRefinementMonitorDetail,
	shouldUseUnicode,
	stageDisplayName,
} from "./lib/ui-monitor.ts";
import { runIdeaRefinementWorkflow } from "./lib/workflow.ts";
import { parsePositiveInteger } from "./lib/validation.ts";
import { runResponseValidatorCheck } from "./lib/validator-check.ts";

const STATUS_KEY = "idea-refinement";
const WIDGET_KEY = "idea-refinement-monitor";
const RENDER_DEBOUNCE_MS = 150;

function shouldNotifyProgressEvent(event: Parameters<typeof applyIdeaRefinementProgressEvent>[1]): boolean {
	switch (event.type) {
		case "workflow_started":
		case "stage_started":
		case "stage_completed":
		case "stage_failed":
		case "loop_completed":
		case "workflow_completed":
		case "workflow_failed":
			return true;
		default:
			return false;
	}
}

function progressEventLevel(event: Parameters<typeof applyIdeaRefinementProgressEvent>[1]): "info" | "warning" | "error" {
	if (event.type === "stage_failed" || event.type === "workflow_failed" || event.isError) return "error";
	return "info";
}

async function collectIdea(args: string, ctx: ExtensionCommandContext): Promise<string | undefined> {
	const inlineIdea = args.trim();
	if (inlineIdea.length > 0) {
		return inlineIdea;
	}

	const editorResult = await ctx.ui.editor("Descreva a ideia a ser refinada", "");
	const idea = editorResult?.trim();
	return idea && idea.length > 0 ? idea : undefined;
}

async function collectLoopCount(ctx: ExtensionCommandContext): Promise<number | undefined> {
	while (true) {
		const input = await ctx.ui.input("Quantos loops de desenvolvimento deseja executar?", "Informe um inteiro positivo");
		if (input === undefined) return undefined;

		const parsed = parsePositiveInteger(input);
		if (parsed !== undefined) return parsed;

		ctx.ui.notify("Valor inválido. Informe um número inteiro positivo.", "warning");
	}
}

function getCurrentModelPattern(ctx: ExtensionCommandContext): string | undefined {
	if (!ctx.model) return undefined;
	return `${ctx.model.provider}/${ctx.model.id}`;
}

export default function ideaRefinementExtension(pi: ExtensionAPI) {
	let runInProgress = false;

	pi.registerCommand("idea-refine", {
		description: "Executa o workflow forçado de refinamento iterativo de ideias",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/idea-refine requer modo interativo.", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("Selecione um modelo antes de executar /idea-refine.", "error");
				return;
			}

			if (!ctx.isIdle()) {
				ctx.ui.notify("Aguarde o agente atual terminar antes de iniciar /idea-refine.", "warning");
				return;
			}

			if (runInProgress) {
				ctx.ui.notify("Já existe uma execução de idea refinement em andamento.", "warning");
				return;
			}

			const idea = await collectIdea(args, ctx);
			if (!idea) {
				ctx.ui.notify("Execução cancelada: nenhuma ideia foi informada.", "info");
				return;
			}

			const loops = await collectLoopCount(ctx);
			if (loops === undefined) {
				ctx.ui.notify("Execução cancelada antes da definição de loops.", "info");
				return;
			}

			const monitorState = createIdeaRefinementMonitorState();
			let renderTimer: ReturnType<typeof setTimeout> | undefined;
			let lastConsoleEventMessage: string | undefined;
			let lastWorkingMessage: string | undefined;

			const renderMonitor = () => {
				const statusLine = buildIdeaRefinementStatusLine(monitorState);
				ctx.ui.setStatus(STATUS_KEY, statusLine);
				// P1-3: Canais com papéis distintos.
				// setStatus = resumo de estado (loop, estágio, score) — já construído em statusLine.
				// setWorkingMessage = detalhe da ação atual — o que o agente está fazendo AGORA.
				const detailLine = monitorState.currentDetail ?? monitorState.lastError ?? undefined;
				const wm = detailLine
					? detailLine.length > 80 ? `${detailLine.slice(0, 77)}...` : detailLine
					: statusLine ? (statusLine.length > 80 ? `${statusLine.slice(0, 77)}...` : statusLine)
					: undefined;
				if (wm !== lastWorkingMessage) {
					lastWorkingMessage = wm;
					ctx.ui.setWorkingMessage?.(wm);
				}
				ctx.ui.setWidget(WIDGET_KEY, buildIdeaRefinementWidgetLines(monitorState));
			};

			const scheduleRender = (immediate = false) => {
				if (immediate) {
					if (renderTimer) {
						clearTimeout(renderTimer);
						renderTimer = undefined;
					}
					renderMonitor();
					return;
				}

				if (renderTimer) return;
				renderTimer = setTimeout(() => {
					renderTimer = undefined;
					renderMonitor();
				}, RENDER_DEBOUNCE_MS);
			};

			const updateUiStatus = (message: string | undefined) => {
				setIdeaRefinementMonitorDetail(monitorState, message);
				scheduleRender(true);
			};

			const handleProgressEvent = (event: Parameters<typeof applyIdeaRefinementProgressEvent>[1]) => {
				applyIdeaRefinementProgressEvent(monitorState, event);
				if (shouldNotifyProgressEvent(event) && event.message !== lastConsoleEventMessage) {
					lastConsoleEventMessage = event.message;
					ctx.ui.notify(event.message, progressEventLevel(event));
				}
				scheduleRender(true);
			};

			runInProgress = true;
			// Limpa dedup cache ao iniciar nova execução
			lastWorkingMessage = undefined;
			ctx.ui.setWorkingVisible?.(true);
			ctx.ui.notify(`Iniciando /idea-refine com ${loops} loop(s). O progresso será exibido no console e no monitor.`, "info");
			updateUiStatus("Inicializando monitor do workflow...");

			try {
				const result = await runIdeaRefinementWorkflow({
					cwd: ctx.cwd,
					idea,
					loops,
					modelPattern: getCurrentModelPattern(ctx),
					onStatus: updateUiStatus,
					onEvent: handleProgressEvent,
				});

				// P1 #6: Valida RESPONSE.md com validator epistêmico (assíncrono, não crítico)
				const responsePath = path.join(result.callDir, "RESPONSE.md");
				runResponseValidatorCheck(responsePath).catch(() => {});

				scheduleRender(true);
				const lastScoreSuffix = typeof result.latestScore === "number" ? ` • score final ${result.latestScore}/100` : "";
				ctx.ui.notify(`Idea refinement concluído: ${result.relativeCallDir}${lastScoreSuffix}`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (monitorState.workflowStatus !== "failed") {
					handleProgressEvent({
						type: "workflow_failed",
						relativeCallDir: monitorState.relativeCallDir ?? "",
						requestedLoops: loops,
						completedLoops: monitorState.completedLoops,
						message: `Falha no workflow: ${message}`,
						isError: true,
					});
				}
				scheduleRender(true);
				ctx.ui.notify(`Falha no workflow de idea refinement: ${message}`, "error");
			} finally {
				runInProgress = false;
				if (renderTimer) {
					clearTimeout(renderTimer);
					renderTimer = undefined;
				}
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.setWorkingMessage?.(undefined);
				ctx.ui.setWorkingVisible?.(false);
			}
		},
	});
}
