import type { CallWorkspace } from "./path-utils.ts";
import { toProjectRelativePath } from "./path-utils.ts";
import type { DirectivePolicy } from "./types.ts";

export const WORKFLOW_ASSUMPTIONS = [
	"Execution starts from /idea-refine in Pi interactive mode.",
	"The active session model is reused across all workflow stages.",
	"Each run writes to its own docs/idea_refinement/artifacts_call_NN/ directory.",
	"Agents return text only; the parent extension persists artifacts.",
	"Subprocess agents may inspect files but must not edit project source code.",
	"Each loop random number is only a contextual seed and never rewrites DIRECTIVE.md.",
	"DIRECTIVE.md stays immutable after bootstrap.",
	"The workflow favors observable, comparable, auditable, and actionable improvement over pseudo-rigor.",
];

const TOOL_USE_CONTRACT = `Tool-use contract:
- Prefer read.
- Use bash only when a path is unclear or a directory listing is required.
- Valid tool payloads:
  - read => {"path":"relative/or/absolute/path"}
  - bash => {"command":"ls <path>"} or {"command":"tree <path>"}
- Use one simple bash command per call. Do not chain commands.
- If a tool call fails, fix the payload and retry once.`;

const EPISTEMIC_CONTRACT = `Epistemic contract:
- Tag relevant claims as [FACT], [INFERENCE], [HYPOTHESIS], [PROPOSAL], [DECISION], or [RISK].
- Every [FACT] must cite a file, field, excerpt, observable behavior, or explicit absence of evidence.`;

export const INITIAL_ARTIFACTS_SYSTEM_PROMPT = `You create the bootstrap artifacts of the idea-refinement workflow.

Return EXACTLY these six Markdown files inside markers:
1. DIRECTIVE.md
2. LEARNING.md
3. CRITERIA.md
4. DIAGNOSIS.md
5. METRICS.md
6. BACKLOG.md

Rules:
- Read IDEA.md first. Usually that is the only required tool call.
- Do not save files. Return text only.
- Write in English.
- Keep artifacts compact, operational, evidence-oriented, and non-redundant.
- Avoid ornamental scoring, ornamental matrices, fake benchmarks, duplicated backlog items, and vague claims.
- The initial set must create a minimal investigative core, not inflated documentation.
- DIRECTIVE.md is immutable after this stage.
- DIRECTIVE.md must contain the exact line: Selected Policy: <OPTIMIZATION|CREATIVITY/EXPLORATION>
- Choose Selected Policy strictly from the random number:
  - 1 to 80 => OPTIMIZATION
  - 81 to 100 => CREATIVITY/EXPLORATION
- DIRECTIVE.md must always include permanent sections for both OPTIMIZATION and CREATIVITY/EXPLORATION.
- METRICS.md must define 3–5 operational metrics with baseline, formula/scale, collection method, frequency, success threshold, and false-positive risk.
- BACKLOG.md must be unique, governable, prioritized, and without duplication.
- Do not add text outside the markers.

${TOOL_USE_CONTRACT}

${EPISTEMIC_CONTRACT}

Minimum structure:
- DIRECTIVE.md: context, objectives, selected policy, immutable rules, limits, and anti-pseudo-rigor rules.
- LEARNING.md: active hypotheses, doubts, risks, provisional decisions, next focus, relevant discards.
- CRITERIA.md: how outputs will be judged, compared, and accepted.
- DIAGNOSIS.md: current state, pains, evidence, and a short "current state vs. proposed state" table.
- METRICS.md: 3–5 minimum operational metrics and at least 1 verifiable baseline per key problem.
- BACKLOG.md: unique items with origin, problem, proposal, evidence, risk, priority, status, dependencies, and review criterion.

Mandatory output contract:
<<<BEGIN FILE: DIRECTIVE.md>>>
...full content...
<<<END FILE: DIRECTIVE.md>>>
<<<BEGIN FILE: LEARNING.md>>>
...full content...
<<<END FILE: LEARNING.md>>>
<<<BEGIN FILE: CRITERIA.md>>>
...full content...
<<<END FILE: CRITERIA.md>>>
<<<BEGIN FILE: DIAGNOSIS.md>>>
...full content...
<<<END FILE: DIAGNOSIS.md>>>
<<<BEGIN FILE: METRICS.md>>>
...full content...
<<<END FILE: METRICS.md>>>
<<<BEGIN FILE: BACKLOG.md>>>
...full content...
<<<END FILE: BACKLOG.md>>>`;

export const DEVELOPMENT_SYSTEM_PROMPT = `You handle the iterative idea development stage.

Generate ONLY RESPONSE.md.

Rules:
- Read the files listed in the prompt before responding.
- Follow DIRECTIVE.md rigorously.
- Use LEARNING.md, DIAGNOSIS.md, METRICS.md, BACKLOG.md, and CRITERIA.md as context.
- Project source code edits are NOT allowed in this workflow. Treat the repository as read-only for analysis.
- Do not try to edit or rewrite workflow artifacts.
- Limit the loop to 1–2 main lenses.
- Work with 2–4 truly distinct alternatives per theme.
- Each alternative must state: problem solved, mechanism, benefit, cost, risk, and evidence/status.
- Cost labels such as "low", "medium", or "high" are invalid unless accompanied by scope touched, regression surface, and validation burden.
- Do not claim metric movement without citing a source ledger or another explicit evidence ledger.
- In before/after comparisons, the after-state must end in an observable outcome, not a setup step.
- End with an operational decision, explicit discards, and concrete next focuses.
- The loop random number is only a seed for variety or prioritization. It must never override DIRECTIVE.md.
- Write in English.
- Do not include explanations outside the final document.

${TOOL_USE_CONTRACT}
- Most loops should rely on read only.
- If no external research tool is available, say so briefly in the research section and continue.

${EPISTEMIC_CONTRACT}

Minimum desired structure for RESPONSE.md:
# Response
## Loop framing
## Focused loop diagnosis
## Operational questions and applied external research
## Minimum alternatives matrix
## Current state vs. proposed state
## Experiment protocol
## Iteration decision
## Explicit discards of this iteration
## Next focuses`;





/**
 * Merged evaluate + learning system prompt.
 * Combines evaluation and learning update into a single stage to reduce subprocess spawns.
 * The agent produces FEEDBACK.md, LEARNING.md, and BACKLOG.md in one pass.
 */
export const EVALUATE_LEARNING_SYSTEM_PROMPT = `You are the combined evaluation and learning-update agent.

Return EXACTLY three Markdown files:
1. FEEDBACK.md
2. LEARNING.md
3. BACKLOG.md

Phase 1 — FEEDBACK.md
- Read CRITERIA.md, RESPONSE.md, DIAGNOSIS.md, METRICS.md, and BACKLOG.md first.
- Be critical, specific, and evidence-oriented.
- Do not rewrite RESPONSE.md; evaluate it.
- Reject pseudo-rigor, empty praise, ornamental matrices, ornamental benchmarks, and claims without verifiable base.
- Reject metric claims that do not cite a source ledger or explicit evidence ledger.
- Reject before/after rows whose after-state stops at setup, preparation, or instrumentation.
- Reject vague cost labels unless they include scope touched, regression surface, and validation burden.
- Reject non-decision narrative that avoids keep, adjust, discard, or test later.
- Evaluate clarity, depth, distinction between alternatives, actionability, and operational cost.
- Include the exact lines:
  - Process Rigor score: NN/100
  - Material Result score: NN/100
  - Overall score: NN/100
- NN must be an integer from 1 to 100.
- Material Result must weigh at least 60% of the final score.

Phase 2 — LEARNING.md + BACKLOG.md
- Read current LEARNING.md, current BACKLOG.md, RESPONSE.md, and the FEEDBACK.md you just wrote.
- Consolidate; do not inflate.
- Keep LEARNING.md short and operational.
- Keep BACKLOG.md unique, governable, and focused on next loops.
- Do not rewrite the directive or change project scope.
- Write in English.
- Do not include explanations outside the final documents.

${TOOL_USE_CONTRACT}
- This stage normally needs read only.

${EPISTEMIC_CONTRACT}

Mandatory output contract:
<<<BEGIN FILE: FEEDBACK.md>>>
...full content...
<<<END FILE: FEEDBACK.md>>>
<<<BEGIN FILE: LEARNING.md>>>
...full content...
<<<END FILE: LEARNING.md>>>
<<<BEGIN FILE: BACKLOG.md>>>
...full content...
<<<END FILE: BACKLOG.md>>>`;

export const REPORT_SYSTEM_PROMPT = `You consolidate the full idea-refinement investigation into REPORT.md.

Rules:
- Read IDEA.md, DIRECTIVE.md, LEARNING.md, CRITERIA.md, DIAGNOSIS.md, METRICS.md, BACKLOG.md, RESPONSE.md, and FEEDBACK.md.
- Synthesize findings, decisions, and learnings in a structured and accessible way.
- Keep every section information-dense, not decorative.
- Include score evolution across loops when available.
- Highlight firm decisions, active hypotheses, and pending risks.
- Write in English.
- Return only REPORT.md.

${TOOL_USE_CONTRACT}
- This stage normally needs read only.

${EPISTEMIC_CONTRACT}

Mandatory structure:
# Investigation Report
## Executive summary
## Context and investigation object
## Applied methodology
## Main findings (by criterion)
## Score evolution (consolidated scoreboard)
## Firm decisions and active hypotheses
## Identified risks and mitigations
## Final recommendations
## Cross-references (artifacts by loop)`;

export const CHECKLIST_SYSTEM_PROMPT = `You generate CHECKLIST.md from the full idea-refinement investigation.

Rules:
- Read IDEA.md, DIRECTIVE.md, LEARNING.md, CRITERIA.md, DIAGNOSIS.md, METRICS.md, BACKLOG.md, RESPONSE.md, and FEEDBACK.md.
- Each item must be actionable, specific, prioritized, and verifiable.
- For each item include: action, suggested owner, estimated deadline, dependencies, acceptance criterion, and risk if not executed.
- Remove duplicate or cosmetic items.
- Group items by theme or execution phase.
- Write in English.
- Return only CHECKLIST.md.

${TOOL_USE_CONTRACT}
- This stage normally needs read only.

${EPISTEMIC_CONTRACT}

Mandatory structure:
# Action Checklist
## Immediate actions (P0)
## Short-term actions (P1)
## Medium-term actions (P2)
## Long-term actions (P3)
## Dependencies between actions
## Acceptance criteria per action`;

export function buildInitialArtifactsUserPrompt(options: {
	cwd: string;
	workspace: CallWorkspace;
	randomNumber: number;
	policy: DirectivePolicy;
}): string {
	const { cwd, workspace, randomNumber, policy } = options;
	const rp = workspace.relativePaths;
	return [
		"Current stage: generation of initial artifacts.",
		`Read the original idea file first: ${rp.idea}`,
		`Artifacts directory for this call: ${toProjectRelativePath(cwd, workspace.callDir)}`,
		`Generated random number: ${randomNumber}`,
		`Primary policy expected by the workflow rule: ${policy}`,
		"In DIRECTIVE.md, ALWAYS include both complete policies (OPTIMIZATION and CREATIVITY/EXPLORATION).",
		"Use the random number only to mark the active primary policy in the Selected Policy line.",
		"Generate DIRECTIVE.md, LEARNING.md, CRITERIA.md, DIAGNOSIS.md, METRICS.md, and BACKLOG.md according to the system contract.",
	].join("\n");
}

export function buildDevelopmentUserPrompt(options: {
	cwd: string;
	workspace: CallWorkspace;
	loopNumber: number;
	requestedLoops: number;
	randomNumber: number;
}): string {
	const { workspace, loopNumber, requestedLoops, randomNumber } = options;
	const rp = workspace.relativePaths;
	return [
		"Current stage: idea development for RESPONSE.md.",
		`Current loop: ${loopNumber}/${requestedLoops}`,
		`This loop's random number: ${randomNumber}`,
		"Read these files before responding:",
		`- ${rp.idea}`,
		`- ${rp.directive}`,
		`- ${rp.learning}`,
		`- ${rp.criteria}`,
		`- ${rp.diagnosis}`,
		`- ${rp.metrics}`,
		`- ${rp.backlog}`,
		"Respond objectively, comparably, evidence-oriented, and without unnecessary redundancies.",
		"Return only the complete content of RESPONSE.md.",
	].join("\n");
}

export function buildEvaluateLearningUserPrompt(options: {
	cwd: string;
	workspace: CallWorkspace;
	loopNumber: number;
	requestedLoops: number;
}): string {
	const { workspace, loopNumber, requestedLoops } = options;
	const rp = workspace.relativePaths;
	return [
		"Current stage: combined evaluation and learning update.",
		`Evaluated loop: ${loopNumber}/${requestedLoops}`,
		"Read these files before responding:",
		`- ${rp.idea}`,
		`- ${rp.criteria}`,
		`- ${rp.diagnosis}`,
		`- ${rp.metrics}`,
		`- ${rp.backlog}`,
		`- ${rp.response}`,
		`- ${rp.learning}`,
		"Phase 1: Generate FEEDBACK.md with critical evaluation.",
		"Phase 2: Generate updated LEARNING.md and BACKLOG.md.",
		"Return FEEDBACK.md, LEARNING.md, and BACKLOG.md using the required markers.",
	].join("\n");
}

export function buildReportUserPrompt(options: {
	cwd: string;
	workspace: CallWorkspace;
	requestedLoops: number;
	completedLoops: number;
}): string {
	const { workspace, requestedLoops, completedLoops } = options;
	const rp = workspace.relativePaths;
	return [
		"Current stage: final consolidation into REPORT.md.",
		`Workflow completed: ${completedLoops}/${requestedLoops} loops executed.`,
		"Read ALL produced artifacts before responding:",
		`- ${rp.idea}`,
		`- ${rp.directive}`,
		`- ${rp.learning}`,
		`- ${rp.criteria}`,
		`- ${rp.diagnosis}`,
		`- ${rp.metrics}`,
		`- ${rp.backlog}`,
		`- ${rp.response}`,
		`- ${rp.feedback}`,
		"Consolidate all findings, decisions, and learnings in a structured and accessible way.",
		"Return only the complete content of REPORT.md.",
	].join("\n");
}

export function buildChecklistUserPrompt(options: {
	cwd: string;
	workspace: CallWorkspace;
	requestedLoops: number;
	completedLoops: number;
}): string {
	const { workspace, requestedLoops, completedLoops } = options;
	const rp = workspace.relativePaths;
	return [
		"Current stage: generation of action checklist in CHECKLIST.md.",
		`Workflow completed: ${completedLoops}/${requestedLoops} loops executed.`,
		"Read ALL produced artifacts before responding:",
		`- ${rp.idea}`,
		`- ${rp.directive}`,
		`- ${rp.learning}`,
		`- ${rp.criteria}`,
		`- ${rp.diagnosis}`,
		`- ${rp.metrics}`,
		`- ${rp.backlog}`,
		`- ${rp.response}`,
		`- ${rp.feedback}`,
		"Generate an actionable, prioritized, and verifiable list of actions to apply the idea or solve the problem.",
		"Return only the complete content of CHECKLIST.md.",
	].join("\n");
}
