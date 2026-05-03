import assert from "node:assert/strict";
import {
	WORKFLOW_ASSUMPTIONS,
	INITIAL_ARTIFACTS_SYSTEM_PROMPT,
	DEVELOPMENT_SYSTEM_PROMPT,
	EVALUATION_SYSTEM_PROMPT,
	LEARNING_UPDATE_SYSTEM_PROMPT,
	REPORT_SYSTEM_PROMPT,
	CHECKLIST_SYSTEM_PROMPT,
	buildInitialArtifactsUserPrompt,
	buildDevelopmentUserPrompt,
	buildEvaluationUserPrompt,
	buildLearningUpdateUserPrompt,
	buildReportUserPrompt,
	buildChecklistUserPrompt,
} from "../../lib/prompts.ts";

const mockWorkspace = {
	baseDir: "/test/docs/idea_refinement",
	callDir: "/test/docs/idea_refinement/artifacts_call_01",
	logsDir: "/test/docs/idea_refinement/artifacts_call_01/logs",
	loopsDir: "/test/docs/idea_refinement/artifacts_call_01/loops",
	rootFiles: {
		idea: "/test/docs/idea_refinement/artifacts_call_01/IDEA.md",
		directive: "/test/docs/idea_refinement/artifacts_call_01/DIRECTIVE.md",
		learning: "/test/docs/idea_refinement/artifacts_call_01/LEARNING.md",
		criteria: "/test/docs/idea_refinement/artifacts_call_01/CRITERIA.md",
		diagnosis: "/test/docs/idea_refinement/artifacts_call_01/DIAGNOSIS.md",
		metrics: "/test/docs/idea_refinement/artifacts_call_01/METRICS.md",
		backlog: "/test/docs/idea_refinement/artifacts_call_01/BACKLOG.md",
		response: "/test/docs/idea_refinement/artifacts_call_01/RESPONSE.md",
		feedback: "/test/docs/idea_refinement/artifacts_call_01/FEEDBACK.md",
		manifest: "/test/docs/idea_refinement/artifacts_call_01/RUN.json",
		report: "/test/docs/idea_refinement/artifacts_call_01/REPORT.md",
		checklist: "/test/docs/idea_refinement/artifacts_call_01/CHECKLIST.md",
	},
};

export async function run(): Promise<void> {
	assert.ok(Array.isArray(WORKFLOW_ASSUMPTIONS));
	assert.ok(WORKFLOW_ASSUMPTIONS.length > 0);
	console.log("✓ WORKFLOW_ASSUMPTIONS definido");

	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /DIRECTIVE\.md/i);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /METRICS\.md/i);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /BACKLOG\.md/i);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /OPTIMIZATION/);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /CREATIVITY\/EXPLORATION/);
	console.log("✓ INITIAL_ARTIFACTS_SYSTEM_PROMPT contém elementos obrigatórios");

	assert.match(DEVELOPMENT_SYSTEM_PROMPT, /Matriz mínima de alternativas/i);
	assert.match(DEVELOPMENT_SYSTEM_PROMPT, /RESPONSE\.md/i);
	console.log("✓ DEVELOPMENT_SYSTEM_PROMPT contém elementos obrigatórios");

	assert.match(EVALUATION_SYSTEM_PROMPT, /manter, ajustar, descartar ou testar depois/i);
	assert.match(EVALUATION_SYSTEM_PROMPT, /Overall score:/);
	console.log("✓ EVALUATION_SYSTEM_PROMPT contém elementos obrigatórios");

	assert.match(LEARNING_UPDATE_SYSTEM_PROMPT, /prefira consolidar a expandir/i);
	assert.match(LEARNING_UPDATE_SYSTEM_PROMPT, /memória operacional/i);
	assert.match(LEARNING_UPDATE_SYSTEM_PROMPT, /BACKLOG\.md/i);
	console.log("✓ LEARNING_UPDATE_SYSTEM_PROMPT contém elementos obrigatórios");

	assert.match(REPORT_SYSTEM_PROMPT, /Relatório de Investigação/i);
	assert.match(REPORT_SYSTEM_PROMPT, /etiqueta epistêmica/i);
	console.log("✓ REPORT_SYSTEM_PROMPT contém elementos obrigatórios");

	assert.match(CHECKLIST_SYSTEM_PROMPT, /Checklist de Ações/i);
	assert.match(CHECKLIST_SYSTEM_PROMPT, /acionável/i);
	console.log("✓ CHECKLIST_SYSTEM_PROMPT contém elementos obrigatórios");

	const initialPrompt = buildInitialArtifactsUserPrompt({ cwd: "/test", workspace: mockWorkspace, randomNumber: 42, policy: "OPTIMIZATION" });
	assert.match(initialPrompt, /42/);
	assert.match(initialPrompt, /OPTIMIZATION/);
	assert.match(initialPrompt, /IDEA\.md/);
	console.log("✓ buildInitialArtifactsUserPrompt constrói corretamente");

	const devPrompt = buildDevelopmentUserPrompt({ cwd: "/test", workspace: mockWorkspace, loopNumber: 1, requestedLoops: 3, randomNumber: 7 });
	assert.match(devPrompt, /1\/3/);
	assert.match(devPrompt, /7/);
	assert.match(devPrompt, /DIRECTIVE\.md/);
	console.log("✓ buildDevelopmentUserPrompt constrói corretamente");

	const evalPrompt = buildEvaluationUserPrompt({ cwd: "/test", workspace: mockWorkspace, loopNumber: 2, requestedLoops: 3 });
	assert.match(evalPrompt, /2\/3/);
	assert.match(evalPrompt, /FEEDBACK\.md/);
	console.log("✓ buildEvaluationUserPrompt constrói corretamente");

	const learningPrompt = buildLearningUpdateUserPrompt({ cwd: "/test", workspace: mockWorkspace, loopNumber: 1, requestedLoops: 3 });
	assert.match(learningPrompt, /1\/3/);
	assert.match(learningPrompt, /LEARNING\.md/);
	assert.match(learningPrompt, /BACKLOG\.md/);
	console.log("✓ buildLearningUpdateUserPrompt constrói corretamente");

	const reportPrompt = buildReportUserPrompt({ cwd: "/test", workspace: mockWorkspace, requestedLoops: 5, completedLoops: 5 });
	assert.match(reportPrompt, /5\/5/);
	assert.match(reportPrompt, /REPORT\.md/);
	console.log("✓ buildReportUserPrompt constrói corretamente");

	const checklistPrompt = buildChecklistUserPrompt({ cwd: "/test", workspace: mockWorkspace, requestedLoops: 5, completedLoops: 5 });
	assert.match(checklistPrompt, /5\/5/);
	assert.match(checklistPrompt, /CHECKLIST\.md/);
	console.log("✓ buildChecklistUserPrompt constrói corretamente");
}
