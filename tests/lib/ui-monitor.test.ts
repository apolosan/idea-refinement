import assert from "node:assert/strict";
import {
	applyIdeaRefinementProgressEvent,
	buildIdeaRefinementStatusLine,
	buildIdeaRefinementWidgetLines,
	createIdeaRefinementMonitorState,
	setIdeaRefinementMonitorDetail,
	shouldUseUnicode,
	stageDisplayName,
	buildStageStatusMessage,
} from "../../lib/ui-monitor.ts";

export async function run(): Promise<void> {
	assert.equal(stageDisplayName("bootstrap"), "artefatos iniciais");
	assert.equal(stageDisplayName("develop"), "desenvolvimento");
	assert.equal(stageDisplayName("evaluate"), "avaliação");
	assert.equal(stageDisplayName("learning"), "aprendizado");
	assert.equal(stageDisplayName("report"), "relatório");
	assert.equal(stageDisplayName("checklist"), "checklist de ações");
	console.log("✓ stageDisplayName mapeia nomes corretamente");

	assert.equal(buildStageStatusMessage("msg"), "msg");
	assert.equal(buildStageStatusMessage("msg", "detail"), "msg • detail");
	console.log("✓ buildStageStatusMessage concatena corretamente");

	const state = createIdeaRefinementMonitorState();
	assert.equal(state.workflowStatus, "idle");
	assert.equal(state.requestedLoops, 0);
	assert.equal(state.bootstrapStatus, "pending");
	console.log("✓ createIdeaRefinementMonitorState inicializa corretamente");

	setIdeaRefinementMonitorDetail(state, "new detail");
	assert.equal(state.currentDetail, "new detail");
	console.log("✓ setIdeaRefinementMonitorDetail atualiza detalhe");

	// Evento workflow_started
	applyIdeaRefinementProgressEvent(state, {
		type: "workflow_started",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 0,
		message: "Workflow iniciado",
	});
	assert.equal(state.workflowStatus, "running");
	assert.equal(state.relativeCallDir, "docs/idea_refinement/artifacts_call_04");
	console.log("✓ applyIdeaRefinementProgressEvent processa workflow_started");

	// Evento stage_started
	applyIdeaRefinementProgressEvent(state, {
		type: "stage_started",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 0,
		message: "Loop 1/3: desenvolvendo",
		stageName: "develop",
		stageStatus: "running",
		loopNumber: 1,
	});
	assert.equal(state.currentStage, "develop");
	assert.equal(state.currentLoop, 1);
	assert.equal(state.loopStageStatuses.develop, "running");
	console.log("✓ applyIdeaRefinementProgressEvent processa stage_started");

	// Evento tool_start
	applyIdeaRefinementProgressEvent(state, {
		type: "tool_start",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 0,
		message: "Ferramenta read iniciada",
		stageName: "develop",
		loopNumber: 1,
		toolName: "read",
	});
	assert.equal(state.activeTool, "read");
	console.log("✓ applyIdeaRefinementProgressEvent processa tool_start");

	// Evento stage_completed
	applyIdeaRefinementProgressEvent(state, {
		type: "stage_completed",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 0,
		message: "desenvolvimento concluído",
		stageName: "develop",
		stageStatus: "success",
		loopNumber: 1,
	});
	assert.equal(state.loopStageStatuses.develop, "success");
	assert.equal(state.activeTool, undefined);
	console.log("✓ applyIdeaRefinementProgressEvent processa stage_completed");

	// Evento loop_completed
	applyIdeaRefinementProgressEvent(state, {
		type: "loop_completed",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 1,
		message: "Loop 1/3 concluído",
		loopNumber: 1,
		score: 72,
	});
	assert.equal(state.completedLoops, 1);
	assert.equal(state.latestScore, 72);
	console.log("✓ applyIdeaRefinementProgressEvent processa loop_completed com score");

	// Evento workflow_completed
	applyIdeaRefinementProgressEvent(state, {
		type: "workflow_completed",
		relativeCallDir: "docs/idea_refinement/artifacts_call_04",
		requestedLoops: 3,
		completedLoops: 3,
		message: "Workflow concluído",
		score: 85,
	});
	assert.equal(state.workflowStatus, "success");
	assert.equal(state.latestScore, 85);
	console.log("✓ applyIdeaRefinementProgressEvent processa workflow_completed");

	// Status line
	const statusLine = buildIdeaRefinementStatusLine(state);
	assert.ok(statusLine);
	assert.match(statusLine, /loop 1\/3/);
	assert.match(statusLine, /score 85\/100/);
	console.log("✓ buildIdeaRefinementStatusLine resume status corretamente");

	// Widget lines
	const widgetLines = buildIdeaRefinementWidgetLines(state);
	const widgetText = widgetLines.join("\n");
	assert.match(widgetText, /\[ IDEA REFINE MONITOR \]/);
	assert.match(widgetText, /\[ PROGRESS \]/);
	assert.match(widgetText, /\[ STAGES \]/);
	assert.match(widgetText, /\[ CURRENT \]/);
	assert.match(widgetText, /bootstrap/);
	assert.match(widgetText, /develop/);
	assert.match(widgetText, /evaluate/);
	assert.match(widgetText, /learning/);
	assert.match(widgetText, /report/);
	assert.match(widgetText, /checklist/);
	console.log("✓ buildIdeaRefinementWidgetLines gera widget completo");

	// Score always visible
	const noScoreState = createIdeaRefinementMonitorState();
	noScoreState.workflowStatus = "running";
	const noScoreWidget = buildIdeaRefinementWidgetLines(noScoreState);
	assert.match(noScoreWidget.join("\n"), /score --\/100/);
	const noScoreStatus = buildIdeaRefinementStatusLine(noScoreState);
	assert.match(noScoreStatus ?? "", /score --\/100/);
	console.log("✓ Score placeholder visível mesmo sem valor");

	// shouldUseUnicode
	assert.equal(typeof shouldUseUnicode(), "boolean");
	const origTerm = process.env.TERM;
	process.env.TERM = "dumb";
	assert.equal(shouldUseUnicode(), false);
	process.env.TERM = "xterm-256color";
	assert.equal(shouldUseUnicode(), true);
	process.env.TERM = origTerm ?? "";
	console.log("✓ shouldUseUnicode detecta capacidade do terminal");

	// ASCII fallback
	process.env.TERM = "dumb";
	const asciiState = createIdeaRefinementMonitorState();
	asciiState.workflowStatus = "running";
	const asciiLines = buildIdeaRefinementWidgetLines(asciiState);
	const asciiText = asciiLines.join("\n");
	assert.doesNotMatch(asciiText, /✓/);
	assert.doesNotMatch(asciiText, /✗/);
	assert.match(asciiText, /status:/i);
	process.env.TERM = origTerm ?? "";
	console.log("✓ Widget usa caracteres ASCII em terminal limitado");

	// Stage failed event
	const failState = createIdeaRefinementMonitorState();
	applyIdeaRefinementProgressEvent(failState, {
		type: "stage_failed",
		relativeCallDir: "docs/idea_refinement/artifacts_call_01",
		requestedLoops: 2,
		completedLoops: 0,
		message: "Erro na etapa",
		stageName: "bootstrap",
		stageStatus: "failed",
		isError: true,
	});
	// T2 fix: stage_failed does NOT change workflowStatus (only workflow_failed does)
	assert.equal(failState.workflowStatus, "idle");
	assert.equal(failState.bootstrapStatus, "failed");
	assert.equal(failState.lastError, undefined); // lastError is set only by workflow_failed
	console.log("✓ applyIdeaRefinementProgressEvent processa stage_failed");
}
