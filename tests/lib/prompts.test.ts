import assert from "node:assert/strict";
import {
	WORKFLOW_ASSUMPTIONS,
	INITIAL_ARTIFACTS_SYSTEM_PROMPT,
	DEVELOPMENT_SYSTEM_PROMPT,
	EVALUATE_LEARNING_SYSTEM_PROMPT,
	REPORT_SYSTEM_PROMPT,
	CHECKLIST_SYSTEM_PROMPT,
	buildInitialArtifactsUserPrompt,
	buildDevelopmentUserPrompt,
	buildEvaluateLearningUserPrompt,
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
	relativePaths: {
		idea: "docs/idea_refinement/artifacts_call_01/IDEA.md",
		directive: "docs/idea_refinement/artifacts_call_01/DIRECTIVE.md",
		learning: "docs/idea_refinement/artifacts_call_01/LEARNING.md",
		criteria: "docs/idea_refinement/artifacts_call_01/CRITERIA.md",
		diagnosis: "docs/idea_refinement/artifacts_call_01/DIAGNOSIS.md",
		metrics: "docs/idea_refinement/artifacts_call_01/METRICS.md",
		backlog: "docs/idea_refinement/artifacts_call_01/BACKLOG.md",
		response: "docs/idea_refinement/artifacts_call_01/RESPONSE.md",
		feedback: "docs/idea_refinement/artifacts_call_01/FEEDBACK.md",
		report: "docs/idea_refinement/artifacts_call_01/REPORT.md",
		checklist: "docs/idea_refinement/artifacts_call_01/CHECKLIST.md",
	},
};

export async function run(): Promise<void> {
	assert.ok(Array.isArray(WORKFLOW_ASSUMPTIONS));
	assert.ok(WORKFLOW_ASSUMPTIONS.length > 0);
	console.log("✓ WORKFLOW_ASSUMPTIONS defined");

	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /DIRECTIVE\.md/i);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /METRICS\.md/i);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /BACKLOG\.md/i);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /OPTIMIZATION/);
	assert.match(INITIAL_ARTIFACTS_SYSTEM_PROMPT, /CREATIVITY\/EXPLORATION/);
	console.log("✓ INITIAL_ARTIFACTS_SYSTEM_PROMPT contains required elements");

	assert.match(DEVELOPMENT_SYSTEM_PROMPT, /Minimum alternatives matrix/i);
	assert.match(DEVELOPMENT_SYSTEM_PROMPT, /RESPONSE\.md/i);
	assert.match(DEVELOPMENT_SYSTEM_PROMPT, /source ledger|evidence ledger/i);
	assert.match(DEVELOPMENT_SYSTEM_PROMPT, /scope touched, regression surface, and validation burden/i);
	console.log("✓ DEVELOPMENT_SYSTEM_PROMPT contains required elements");

	assert.match(REPORT_SYSTEM_PROMPT, /Investigation Report/i);
	assert.match(REPORT_SYSTEM_PROMPT, /epistemic tag/i);
	console.log("✓ REPORT_SYSTEM_PROMPT contains required elements");

	assert.match(CHECKLIST_SYSTEM_PROMPT, /Action Checklist/i);
	assert.match(CHECKLIST_SYSTEM_PROMPT, /actionable/i);
	console.log("✓ CHECKLIST_SYSTEM_PROMPT contains required elements");

	assert.match(EVALUATE_LEARNING_SYSTEM_PROMPT, /combined evaluation/i);
	assert.match(EVALUATE_LEARNING_SYSTEM_PROMPT, /FEEDBACK\.md/);
	assert.match(EVALUATE_LEARNING_SYSTEM_PROMPT, /LEARNING\.md/);
	assert.match(EVALUATE_LEARNING_SYSTEM_PROMPT, /BACKLOG\.md/);
	assert.match(EVALUATE_LEARNING_SYSTEM_PROMPT, /Overall score:/);
	assert.match(EVALUATE_LEARNING_SYSTEM_PROMPT, /Reject metric claims that do not cite a source ledger/i);
	assert.match(EVALUATE_LEARNING_SYSTEM_PROMPT, /Reject non-decision narrative/i);
	console.log("✓ EVALUATE_LEARNING_SYSTEM_PROMPT contains required elements");

	const initialPrompt = buildInitialArtifactsUserPrompt({ cwd: "/test", workspace: mockWorkspace, randomNumber: 42, policy: "OPTIMIZATION" });
	assert.match(initialPrompt, /42/);
	assert.match(initialPrompt, /OPTIMIZATION/);
	assert.match(initialPrompt, /IDEA\.md/);
	console.log("✓ buildInitialArtifactsUserPrompt builds correctly");

	const devPrompt = buildDevelopmentUserPrompt({ cwd: "/test", workspace: mockWorkspace, loopNumber: 1, requestedLoops: 3, randomNumber: 7 });
	assert.match(devPrompt, /1\/3/);
	assert.match(devPrompt, /7/);
	assert.match(devPrompt, /DIRECTIVE\.md/);
	console.log("✓ buildDevelopmentUserPrompt builds correctly");

	const reportPrompt = buildReportUserPrompt({ cwd: "/test", workspace: mockWorkspace, requestedLoops: 5, completedLoops: 5 });
	assert.match(reportPrompt, /5\/5/);
	assert.match(reportPrompt, /REPORT\.md/);
	console.log("✓ buildReportUserPrompt builds correctly");

	const checklistPrompt = buildChecklistUserPrompt({ cwd: "/test", workspace: mockWorkspace, requestedLoops: 5, completedLoops: 5 });
	assert.match(checklistPrompt, /5\/5/);
	assert.match(checklistPrompt, /CHECKLIST\.md/);
	console.log("✓ buildChecklistUserPrompt builds correctly");

	const evalLearnPrompt = buildEvaluateLearningUserPrompt({ cwd: "/test", workspace: mockWorkspace, loopNumber: 2, requestedLoops: 3 });
	assert.match(evalLearnPrompt, /2\/3/);
	assert.match(evalLearnPrompt, /FEEDBACK\.md/);
	assert.match(evalLearnPrompt, /LEARNING\.md/);
	assert.match(evalLearnPrompt, /BACKLOG\.md/);
	console.log("✓ buildEvaluateLearningUserPrompt builds correctly");
}
