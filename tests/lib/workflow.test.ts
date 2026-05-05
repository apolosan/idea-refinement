import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runIdeaRefinementResumeWorkflow, runIdeaRefinementWorkflow } from "../../lib/workflow.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

/**
 * Creates a fake "pi" script that reads the system prompt from args
 * and outputs structured responses with marked sections.
 * The standard args from buildPiArgs are appended automatically by runPiStage.
 */
async function createFakePiScript(dir: string): Promise<{ command: string; args: string[] }> {
	const scriptPath = path.join(dir, "fake-pi.mjs");

	// Script reads --append-system-prompt from args (appended by buildPiArgs)
	const scriptContent = [
		`import { readFileSync } from "node:fs";`,
		`const args = process.argv.slice(2);`,
		`let sp = "";`,
		`for (let i = 0; i < args.length - 1; i++) {`,
		`  if (args[i] === "--append-system-prompt") { try { sp = readFileSync(args[i+1], "utf-8"); } catch {} break; }`,
		`}`,
		`function tag(n, c) { return "<<<BEGIN FILE: " + n + ">>>\\n" + c + "\\n<<<END FILE: " + n + ">>>"; }`,
		`let r;`,
		`if (sp.includes("initial artifacts")) {`,
		`  r = [tag("DIRECTIVE.md","# Dir\\nSelected Policy: OPTIMIZATION\\n## OPT\\nFocus on measurable improvement.\\n## CREAT\\nExplore novel approaches."),`,
		`       tag("LEARNING.md","# Learn\\n[HYP] First entry."),`,
		`       tag("CRITERIA.md","# Crit\\n## V\\nBefore/after with metrics."),`,
		`       tag("DIAGNOSIS.md","# Diag\\n[FACT] Initial assessment.\\n[INF] Key inference.\\n## Current vs Proposed\\nCurrent: unvalidated. Proposed: structured."),`,
		`       tag("METRICS.md","# Met\\n## M1\\n- Scale: 1-10\\n- Baseline: 3/10\\n- Target: 7/10"),`,
		`       tag("BACKLOG.md","# BL\\n|ID|P|S|D|\\n|---|---|---|---|\\n|B1|P0|pend|Validate|\\n|B2|P1|pend|Explore|")`,
		`  ].join("\\n");`,
		`} else if (sp.includes("iterative idea development")) {`,
		`  r = ["# Response","## Loop framing","Analyzing focus.","## Focused loop diagnosis",`,
		`       "[FACT] Evidence: src/index.ts.","[FACT] More: lib/workflow.ts.","## Operational questions and applied external research","What to measure?",`,
		`       "## Minimum alternatives matrix","|Alt|P|M|B|C|R|","|---|---|---|---|---|---|","|A|X|Y|Z|L|N|","|B|X2|Y2|Z2|M|S|","|C|X3|Y3|Z3|H|Ma|",`,
		`       "## Current state vs. proposed state","before: baseline 5/10, after: target 7/10 (40% improvement)",`,
		`       "## Experiment protocol","Run tests.","## Iteration decision","Keep A. Adjust B.",`,
		`       "## Explicit discards of this iteration","Discard C.","## Next focuses","Test later.",`,
		`       "[INFERENCE] Bottleneck identified.","[RISK] Over-engineering risk."`,
		`  ].join("\\n");`,
		`} else if (sp.includes("combined evaluation") || sp.includes("evaluation and learning consolidation")) {`,
		`  // Merged evaluate+learning: produce FEEDBACK.md, LEARNING.md, and BACKLOG.md in one pass`,
		`  const fb = ["# Feedback","## Overall verdict","Solid.","## Evidence supporting the verdict","[FACT] Template.",`,
		`       "## Before/after comparability evaluation","Before: x. After: y.","## Epistemic audit","Tags ok.",`,
		`       "## Criterion-by-criterion evaluation","Pass.","## Final iteration decision","Keep.",`,
		`       "## Objective recommendations for the next iteration","Evidence.","## Scoreboard",`,
		`       "Process Rigor score: 72/100","Material Result score: 68/100","Overall score: 70/100"`,
		`  ].join("\\n");`,
		`  r = [tag("FEEDBACK.md", fb),`,
		`       tag("LEARNING.md","# Learn\\n[HYP] Works.\\n[DECISION] Maintain."),`,
		`       tag("BACKLOG.md","# BL\\n|ID|P|S|D|\\n|---|---|---|---|\\n|B1|P0|done|X|\\n|B2|P1|pend|Y|\\n|B3|P2|new|Z|")`,
		`  ].join("\\n");`,
		`} else if (sp.includes("consolidating") || sp.includes("Investigation Report")) {`,
		`  r = ["# Investigation Report","## Executive summary","Done.","## Context and investigation object","Analyzed.",`,
		`       "## Applied methodology","Iterative.","## Main findings","[FACT] Findings.",`,
		`       "## Score evolution","70/100.","## Firm decisions and active hypotheses","[DECISION] OK.",`,
		`       "## Identified risks and mitigations","[RISK] Complex.","## Final recommendations","Proceed.",`,
		`       "## Cross-references","All."`,
		`  ].join("\\n");`,
		`} else if (sp.includes("action checklist") || sp.includes("Action Checklist")) {`,
		`  r = ["# Action Checklist","## Immediate actions (P0)","- Validate [DECISION]",`,
		`       "## Short-term actions (P1)","- Implement","## Medium-term actions (P2)","- Monitor",`,
		`       "## Long-term actions (P3)","- Scale","## Dependencies between actions","P0->P1.",`,
		`       "## Acceptance criteria per action","Measurable."`,
		`  ].join("\\n");`,
		`} else {`,
		`  r = "DEFAULT len=" + sp.length;`,
		`}`,
		`process.stdout.write(JSON.stringify({type:"session"})+"\\n");`,
		`process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:r}],model:"test",usage:{input:100,output:50,cacheRead:0,cacheWrite:0,totalTokens:150,cost:{total:0}},stopReason:"stop"}})+"\\n");`,
		`process.exit(0);`,
	].join("\n");

	await fs.writeFile(scriptPath, scriptContent, "utf-8");
	// Only provide command and base args (script path). Standard args are appended by runPiStage.
	return { command: process.execPath, args: [scriptPath] };
}

export async function run(): Promise<void> {
	await withTempDir(async (dir) => {
		const events: string[] = [];
		const statuses: string[] = [];

		const invocation = await createFakePiScript(dir);

		const result = await runIdeaRefinementWorkflow({
			cwd: dir,
			idea: "Test idea for unit testing the workflow orchestrator",
			loops: 1,
			modelPattern: undefined,
			thinkingLevel: undefined,
			onStatus: (msg) => { if (msg) statuses.push(msg); },
			onEvent: (evt) => events.push(evt.type),
			invocation,
		});

		assert.ok(result.callDir.includes("artifacts_call_"));
		assert.ok(result.relativeCallDir.includes("artifacts_call_"));
		assert.equal(result.manifest.status, "success");
		assert.equal(result.manifest.requestedLoops, 1);
		assert.equal(result.manifest.completedLoops, 1);
		assert.ok(result.manifest.bootstrap.status === "success" || result.manifest.bootstrap.status === "failed");

		// Verify created files (manifest stores relative paths, resolve against dir)
		for (const filePath of Object.values(result.manifest.files)) {
			await fs.access(path.resolve(dir, filePath));
		}
		await fs.access(path.join(result.callDir, "run.json"));

		// X1 fix: minimum content assertions for bootstrap artifacts
		const directive = await fs.readFile(path.resolve(dir, result.manifest.files.directive), "utf-8");
		assert.ok(directive.includes("Selected Policy:"), "DIRECTIVE.md must contain 'Selected Policy:'");

		const backlog = await fs.readFile(path.resolve(dir, result.manifest.files.backlog), "utf-8");
		assert.ok(/P[0-3]/.test(backlog), "BACKLOG.md must contain at least one priority P0-P3");

		const learning = await fs.readFile(path.resolve(dir, result.manifest.files.learning), "utf-8");
		assert.ok(/\[HYP\]|\[FACT\]|\[DECISION\]|\[INFERENCE\]|\[RISK\]/.test(learning), "LEARNING.md must contain an epistemic tag");

		const diagnosis = await fs.readFile(path.resolve(dir, result.manifest.files.diagnosis), "utf-8");
		assert.ok(diagnosis.includes("[FACT]"), "DIAGNOSIS.md must contain at least one [FACT]");

		const metrics = await fs.readFile(path.resolve(dir, result.manifest.files.metrics), "utf-8");
		assert.ok(metrics.includes("Baseline") || metrics.includes("## M"), "METRICS.md must contain Baseline or metric section");

		const criteria = await fs.readFile(path.resolve(dir, result.manifest.files.criteria), "utf-8");
		assert.ok(criteria.includes("## V") || criteria.includes("Vision"), "CRITERIA.md must contain validation vision");

		// C1 fix: Verify report and checklist stages are properly tracked
		assert.equal(result.manifest.report.status, "success");
		assert.equal(result.manifest.checklist.status, "success");

		// Verify loop structure
		assert.equal(result.manifest.loops.length, 1);
		const loop = result.manifest.loops[0];
		assert.equal(loop.loopNumber, 1);
		assert.ok(loop.randomNumber >= 1 && loop.randomNumber <= 100);
		assert.ok(loop.stages.develop.status === "success" || loop.stages.develop.status === "failed");
		assert.ok(loop.stages.evaluate.status === "success" || loop.stages.evaluate.status === "failed");
		assert.ok(loop.stages.learning.status === "success" || loop.stages.learning.status === "failed");

		// Verify events
		assert.ok(events.includes("workflow_started"));
		assert.ok(events.includes("workflow_completed") || events.includes("workflow_failed"));
		console.log("✓ runIdeaRefinementWorkflow executes complete workflow with 1 loop");
	});

	// B22: Test bootstrap retry logic - first 2 attempts fail marker parsing, 3rd succeeds
	await withTempDir(async (dir) => {
		const counterPath = path.join(dir, "attempt-counter.txt");
		await fs.writeFile(counterPath, "0", "utf-8");

		// Write the fake pi script that uses a counter file to track attempts
		const scriptPath = path.join(dir, "fake-pi-retry.mjs");
		const dirForScript = dir.replace(/\\/g, "\\\\");
		const scriptLines = [
			'import { readFileSync, writeFileSync } from "node:fs";',
			'import { join } from "node:path";',
			'const args = process.argv.slice(2);',
			'let sp = "";',
			'for (let i = 0; i < args.length - 1; i++) {',
			'  if (args[i] === "--append-system-prompt") { try { sp = readFileSync(args[i+1], "utf-8"); } catch {} break; }',
			'}',
			'function tag(n, c) { return "<<<BEGIN FILE: " + n + ">>>\\n" + c + "\\n<<<END FILE: " + n + ">>>"; }',
			'let r;',
			'if (sp.includes("initial artifacts")) {',
			`  const counterFile = join("${dirForScript}", "attempt-counter.txt");`,
			'  let count = parseInt(readFileSync(counterFile, "utf-8"), 10);',
			'  count++;',
			'  writeFileSync(counterFile, String(count), "utf-8");',
			'  if (count <= 2) {',
			'    r = "This response has no markers at all. Just plain text.";',
			'  } else {',
			'    r = [',
			'      tag("DIRECTIVE.md", "# Dir\\nSelected Policy: OPTIMIZATION\\n## OPT\\nFocus on measurable improvement.\\n## CREAT\\nExplore novel approaches."),',
			'      tag("LEARNING.md", "# Learn\\n[HYP] First entry."),',
			'      tag("CRITERIA.md", "# Crit\\n## V\\nBefore/after with metrics."),',
			'      tag("DIAGNOSIS.md", "# Diag\\n[FACT] Initial assessment.\\n[INF] Key inference.\\n## Current vs Proposed\\nCurrent: unvalidated. Proposed: structured."),',
			'      tag("METRICS.md", "# Met\\n## M1\\n- Scale: 1-10\\n- Baseline: 3/10\\n- Target: 7/10"),',
			'      tag("BACKLOG.md", "# BL\\n|ID|P|S|D|\\n|---|---|---|---|\\n|B1|P0|pend|Validate|\\n|B2|P1|pend|Explore|")',
			'    ].join("\\n");',
			'  }',
			'} else if (sp.includes("iterative idea development")) {',
			'  r = [',
			'    "# Response", "## Loop framing", "Analyzing focus.", "## Focused loop diagnosis",',
			'    "[FACT] Evidence: src/index.ts.", "[FACT] More: lib/workflow.ts.", "## Operational questions and applied external research", "What to measure?",',
			'    "## Minimum alternatives matrix", "|Alt|P|M|B|C|R|", "|---|---|---|---|---|---|", "|A|X|Y|Z|L|N|", "|B|X2|Y2|Z2|M|S|", "|C|X3|Y3|Z3|H|Ma|",',
			'    "## Current state vs. proposed state", "before: baseline 5/10, after: target 7/10 (40% improvement)",',
			'    "## Experiment protocol", "Run tests.", "## Iteration decision", "Keep A. Adjust B.",',
			'    "## Explicit discards of this iteration", "Discard C.", "## Next focuses", "Test later.",',
			'    "[INFERENCE] Bottleneck identified.", "[RISK] Over-engineering risk."',
			'  ].join("\\n");',
			'} else if (sp.includes("combined evaluation") || sp.includes("evaluation and learning consolidation")) {',
			'  const fb = [',
			'    "# Feedback", "## Overall verdict", "Solid.", "## Evidence supporting the verdict", "[FACT] Template.",',
			'    "## Before/after comparability evaluation", "Before: x. After: y.", "## Epistemic audit", "Tags ok.",',
			'    "## Criterion-by-criterion evaluation", "Pass.", "## Final iteration decision", "Keep.",',
			'    "## Objective recommendations for the next iteration", "Evidence.", "## Scoreboard",',
			'    "Process Rigor score: 72/100", "Material Result score: 68/100", "Overall score: 70/100"',
			'  ].join("\\n");',
			'  r = [',
			'    tag("FEEDBACK.md", fb),',
			'    tag("LEARNING.md", "# Learn\\n[HYP] Works.\\n[DECISION] Maintain."),',
			'    tag("BACKLOG.md", "# BL\\n|ID|P|S|D|\\n|---|---|---|---|\\n|B1|P0|done|X|\\n|B2|P1|pend|Y|\\n|B3|P2|new|Z|")',
			'  ].join("\\n");',
			'} else if (sp.includes("consolidating") || sp.includes("Investigation Report")) {',
			'  r = [',
			'    "# Investigation Report", "## Executive summary", "Done.", "## Context and investigation object", "Analyzed.",',
			'    "## Applied methodology", "Iterative.", "## Main findings", "[FACT] Findings.",',
			'    "## Score evolution", "70/100.", "## Firm decisions and active hypotheses", "[DECISION] OK.",',
			'    "## Identified risks and mitigations", "[RISK] Complex.", "## Final recommendations", "Proceed.",',
			'    "## Cross-references", "All."',
			'  ].join("\\n");',
			'} else if (sp.includes("action checklist") || sp.includes("Action Checklist")) {',
			'  r = [',
			'    "# Action Checklist", "## Immediate actions (P0)", "- Validate [DECISION]",',
			'    "## Short-term actions (P1)", "- Implement", "## Medium-term actions (P2)", "- Monitor",',
			'    "## Long-term actions (P3)", "- Scale", "## Dependencies between actions", "P0->P1.",',
			'    "## Acceptance criteria per action", "Measurable."',
			'  ].join("\\n");',
			'} else {',
			'  r = "DEFAULT len=" + sp.length;',
			'}',
			'process.stdout.write(JSON.stringify({type:"session"})+"\\n");',
			'process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:r}],model:"test",usage:{input:100,output:50,cacheRead:0,cacheWrite:0,totalTokens:150,cost:{total:0}},stopReason:"stop"}})+"\\n");',
			'process.exit(0);',
		];

		await fs.writeFile(scriptPath, scriptLines.join("\n"), "utf-8");
		const invocation = { command: process.execPath, args: [scriptPath] };

		const statuses: string[] = [];
		const result = await runIdeaRefinementWorkflow({
			cwd: dir,
			idea: "Test bootstrap retry logic",
			loops: 1,
			modelPattern: undefined,
			thinkingLevel: undefined,
			onStatus: (msg) => { if (msg) statuses.push(msg); },
			onEvent: () => {},
			invocation,
		});

		// Verify workflow succeeded despite 2 failed bootstrap attempts
		assert.equal(result.manifest.status, "success", "Workflow should succeed after retry");

		// Verify the counter shows 3 attempts were made
		const finalCount = parseInt(await fs.readFile(counterPath, "utf-8"), 10);
		assert.equal(finalCount, 3, `Expected 3 bootstrap attempts, got ${finalCount}`);

		// Verify status messages mention retry attempts
		const retryMessages = statuses.filter(s => s.includes("attempt"));
		assert.ok(retryMessages.length >= 2, `Expected at least 2 retry status messages, got ${retryMessages.length}`);

		// Verify bootstrap-raw-attempt files were created for failed attempts
		const attempt1File = path.join(result.callDir, "bootstrap-raw-attempt-1.md");
		const attempt2File = path.join(result.callDir, "bootstrap-raw-attempt-2.md");
		await fs.access(attempt1File);
		await fs.access(attempt2File);

		// Verify bootstrap artifacts were written from the successful 3rd attempt
		const directive = await fs.readFile(path.resolve(dir, result.manifest.files.directive), "utf-8");
		assert.ok(directive.includes("Selected Policy:"), "DIRECTIVE.md should be from successful attempt");

		console.log("✓ B22: bootstrap retry logic works (fails 2x, succeeds on 3rd)");
	});

	// B23: evaluate+learning retry logic - first attempt returns truncated FEEDBACK block, second succeeds
	await withTempDir(async (dir) => {
		const counterPath = path.join(dir, "evaluate-attempt-counter.txt");
		await fs.writeFile(counterPath, "0", "utf-8");

		const scriptPath = path.join(dir, "fake-pi-evaluate-retry.mjs");
		const dirForScript = dir.replace(/\\/g, "\\\\");
		const scriptLines = [
			'import { readFileSync, writeFileSync } from "node:fs";',
			'import { join } from "node:path";',
			'const args = process.argv.slice(2);',
			'let sp = "";',
			'for (let i = 0; i < args.length - 1; i++) {',
			'  if (args[i] === "--append-system-prompt") { try { sp = readFileSync(args[i+1], "utf-8"); } catch {} break; }',
			'}',
			'function tag(n, c) { return "<<<BEGIN FILE: " + n + ">>>\\n" + c + "\\n<<<END FILE: " + n + ">>>"; }',
			'let r;',
			'if (sp.includes("initial artifacts")) {',
			'  r = [',
			'    tag("DIRECTIVE.md", "# Dir\\nSelected Policy: OPTIMIZATION\\n## OPT\\nFocus on measurable improvement.\\n## CREAT\\nExplore novel approaches."),',
			'    tag("LEARNING.md", "# Learn\\n[HYP] First entry."),',
			'    tag("CRITERIA.md", "# Crit\\n## V\\nBefore/after with metrics."),',
			'    tag("DIAGNOSIS.md", "# Diag\\n[FACT] Initial assessment.\\n[INF] Key inference.\\n## Current vs Proposed\\nCurrent: unvalidated. Proposed: structured."),',
			'    tag("METRICS.md", "# Met\\n## M1\\n- Scale: 1-10\\n- Baseline: 3/10\\n- Target: 7/10"),',
			'    tag("BACKLOG.md", "# BL\\n|ID|P|S|D|\\n|---|---|---|---|\\n|B1|P0|pend|Validate|\\n|B2|P1|pend|Explore|")',
			'  ].join("\\n");',
			'} else if (sp.includes("iterative idea development")) {',
			'  r = [',
			'    "# Response", "## Loop framing", "Analyzing focus.", "## Focused loop diagnosis",',
			'    "[FACT] Evidence: src/index.ts.", "[FACT] More: lib/workflow.ts.", "## Operational questions and applied external research", "What to measure?",',
			'    "## Minimum alternatives matrix", "|Alt|P|M|B|C|R|", "|---|---|---|---|---|---|", "|A|X|Y|Z|L|N|", "|B|X2|Y2|Z2|M|S|", "|C|X3|Y3|Z3|H|Ma|",',
			'    "## Current state vs. proposed state", "before: baseline 5/10, after: target 7/10 (40% improvement)",',
			'    "## Experiment protocol", "Run tests.", "## Iteration decision", "Keep A. Adjust B.",',
			'    "## Explicit discards of this iteration", "Discard C.", "## Next focuses", "Test later.",',
			'    "[INFERENCE] Bottleneck identified.", "[RISK] Over-engineering risk."',
			'  ].join("\\n");',
			'} else if (sp.includes("combined evaluation") || sp.includes("evaluation and learning consolidation")) {',
			`  const counterFile = join("${dirForScript}", "evaluate-attempt-counter.txt");`,
			'  let count = parseInt(readFileSync(counterFile, "utf-8"), 10);',
			'  count++;',
			'  writeFileSync(counterFile, String(count), "utf-8");',
			'  if (count === 1) {',
			'    r = "<<<BEGIN FILE: FEEDBACK.md>>>\\n# FEEDBACK\\nThis first attempt is intentionally truncated before the end marker.";',
			'  } else {',
			'    const fb = [',
			'      "# Feedback", "## Overall verdict", "Solid.", "## Evidence supporting the verdict", "[FACT] Template.",',
			'      "## Before/after comparability evaluation", "Before: x. After: y.", "## Epistemic audit", "Tags ok.",',
			'      "## Criterion-by-criterion evaluation", "Pass.", "## Final iteration decision", "Keep.",',
			'      "## Objective recommendations for the next iteration", "Evidence.", "## Scoreboard",',
			'      "Process Rigor score: 72/100", "Material Result score: 68/100", "Overall score: 70/100"',
			'    ].join("\\n");',
			'    r = [',
			'      tag("FEEDBACK.md", fb),',
			'      tag("LEARNING.md", "# Learn\\n[HYP] Works.\\n[DECISION] Maintain."),',
			'      tag("BACKLOG.md", "# BL\\n|ID|P|S|D|\\n|---|---|---|---|\\n|B1|P0|done|X|\\n|B2|P1|pend|Y|\\n|B3|P2|new|Z|")',
			'    ].join("\\n");',
			'  }',
			'} else if (sp.includes("consolidating") || sp.includes("Investigation Report")) {',
			'  r = [',
			'    "# Investigation Report", "## Executive summary", "Done.", "## Context and investigation object", "Analyzed.",',
			'    "## Applied methodology", "Iterative.", "## Main findings", "[FACT] Findings.",',
			'    "## Score evolution", "70/100.", "## Firm decisions and active hypotheses", "[DECISION] OK.",',
			'    "## Identified risks and mitigations", "[RISK] Complex.", "## Final recommendations", "Proceed.",',
			'    "## Cross-references", "All."',
			'  ].join("\\n");',
			'} else if (sp.includes("action checklist") || sp.includes("Action Checklist")) {',
			'  r = [',
			'    "# Action Checklist", "## Immediate actions (P0)", "- Validate [DECISION]",',
			'    "## Short-term actions (P1)", "- Implement", "## Medium-term actions (P2)", "- Monitor",',
			'    "## Long-term actions (P3)", "- Scale", "## Dependencies between actions", "P0->P1.",',
			'    "## Acceptance criteria per action", "Measurable."',
			'  ].join("\\n");',
			'} else {',
			'  r = "DEFAULT len=" + sp.length;',
			'}',
			'process.stdout.write(JSON.stringify({type:"session"})+"\\n");',
			'process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:r}],model:"test",usage:{input:100,output:50,cacheRead:0,cacheWrite:0,totalTokens:150,cost:{total:0}},stopReason:"stop"}})+"\\n");',
			'process.exit(0);',
		];

		await fs.writeFile(scriptPath, scriptLines.join("\n"), "utf-8");
		const invocation = { command: process.execPath, args: [scriptPath] };
		const statuses: string[] = [];

		const result = await runIdeaRefinementWorkflow({
			cwd: dir,
			idea: "Test evaluate retry logic",
			loops: 1,
			onStatus: (msg) => { if (msg) statuses.push(msg); },
			onEvent: () => {},
			invocation,
		});

		assert.equal(result.manifest.status, "success", "Workflow should succeed after evaluate retry");
		const finalCount = parseInt(await fs.readFile(counterPath, "utf-8"), 10);
		assert.equal(finalCount, 2, `Expected 2 evaluate attempts, got ${finalCount}`);
		const rawAttemptFile = path.join(result.callDir, "loops", "loop_01", "evaluate-raw-attempt-1.md");
		await fs.access(rawAttemptFile);
		assert.ok(statuses.some((s) => s.includes("evaluate output parse failed on attempt 1/3")));
		const feedback = await fs.readFile(path.join(result.callDir, "FEEDBACK.md"), "utf-8");
		assert.ok(feedback.includes("Overall score: 70/100"));

		console.log("✓ B23: evaluate+learning retry logic works (truncated 1x, succeeds on 2nd)");
	});

	// R1: resume flow can continue from a failed run specified by execution index (NN)
	await withTempDir(async (dir) => {
		const invocation = await createFakePiScript(dir);
		const seedResult = await runIdeaRefinementWorkflow({
			cwd: dir,
			idea: "Seed run for resume test",
			loops: 1,
			onStatus: () => {},
			onEvent: () => {},
			invocation,
		});

		const manifestPath = path.join(seedResult.callDir, "run.json");
		const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
		manifest.status = "failed";
		manifest.requestedLoops = 2;
		manifest.completedLoops = 1;
		manifest.lastError = "Synthetic evaluate failure for resume";
		manifest.loops.push({
			loopNumber: 2,
			randomNumber: 77,
			startedAt: new Date().toISOString(),
			responsePath: `${manifest.callDir}/loops/loop_02/RESPONSE.md`,
			feedbackPath: `${manifest.callDir}/loops/loop_02/FEEDBACK.md`,
			learningPath: `${manifest.callDir}/loops/loop_02/LEARNING.md`,
			stages: {
				develop: {
					name: "develop",
					status: "success",
					logPath: `${manifest.callDir}/logs/loop_02_develop.jsonl`,
					stderrPath: `${manifest.callDir}/logs/loop_02_develop.stderr.log`,
				},
				evaluate: {
					name: "evaluate",
					status: "failed",
					logPath: `${manifest.callDir}/logs/loop_02_evaluate.jsonl`,
					stderrPath: `${manifest.callDir}/logs/loop_02_evaluate.stderr.log`,
					errorMessage: "Synthetic evaluate failure",
				},
				learning: {
					name: "learning",
					status: "pending",
					logPath: `${manifest.callDir}/logs/loop_02_learning.jsonl`,
					stderrPath: `${manifest.callDir}/logs/loop_02_learning.stderr.log`,
				},
			},
		});
		await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

		const resumed = await runIdeaRefinementResumeWorkflow({
			cwd: dir,
			sourceCallSpecifier: "1",
			finalLoopCount: 2,
			workaroundInstructions: "Resume from the last consistent loop and ignore the synthetic failed partial loop.",
			onStatus: () => {},
			onEvent: () => {},
			invocation,
		});

		assert.equal(resumed.manifest.status, "success");
		assert.equal(resumed.manifest.requestedLoops, 2);
		assert.equal(resumed.manifest.completedLoops, 2);
		assert.equal(resumed.resumeAnalysis.lastConsistentLoop, 1);
		assert.equal(resumed.resumeAnalysis.failureCategory, "loop_evaluate_failed");
		assert.equal(resumed.manifest.resume?.sourceCallId, "artifacts_call_01");
		await fs.access(path.join(resumed.callDir, "RESUME_CONTEXT.md"));
		await fs.access(path.join(resumed.callDir, "loops", "loop_01", "RESPONSE.md"));
		await fs.access(path.join(resumed.callDir, "loops", "loop_02", "RESPONSE.md"));

		console.log("✓ R1: resume flow continues from failed run using execution index (NN)");
	});

	// R2: resume flow can recover from a bootstrap failure using existing artifacts_call_NN source metadata
	await withTempDir(async (dir) => {
		const sourceDir = path.join(dir, "docs", "idea_refinement", "artifacts_call_01");
		await fs.mkdir(sourceDir, { recursive: true });
		await fs.writeFile(path.join(sourceDir, "IDEA.md"), "Resume bootstrap failure idea\n", "utf-8");
		const failedManifest = {
			schemaVersion: 1,
			status: "failed",
			cwd: dir,
			callNumber: 1,
			callId: "artifacts_call_01",
			callDir: "docs/idea_refinement/artifacts_call_01",
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			requestedLoops: 1,
			completedLoops: 0,
			files: {
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
			bootstrap: {
				name: "bootstrap",
				status: "failed",
				logPath: "docs/idea_refinement/artifacts_call_01/logs/bootstrap.jsonl",
				stderrPath: "docs/idea_refinement/artifacts_call_01/logs/bootstrap.stderr.log",
				errorMessage: "Synthetic bootstrap failure",
			},
			report: { name: "report", status: "pending", logPath: "docs/idea_refinement/artifacts_call_01/logs/report.jsonl", stderrPath: "docs/idea_refinement/artifacts_call_01/logs/report.stderr.log" },
			checklist: { name: "checklist", status: "pending", logPath: "docs/idea_refinement/artifacts_call_01/logs/checklist.jsonl", stderrPath: "docs/idea_refinement/artifacts_call_01/logs/checklist.stderr.log" },
			loops: [],
			assumptions: [],
			lastError: "Synthetic bootstrap failure",
		};
		await fs.writeFile(path.join(sourceDir, "run.json"), `${JSON.stringify(failedManifest, null, 2)}\n`, "utf-8");

		const invocation = await createFakePiScript(dir);
		const resumed = await runIdeaRefinementResumeWorkflow({
			cwd: dir,
			sourceCallSpecifier: "1",
			finalLoopCount: 1,
			workaroundInstructions: "Rebuild bootstrap artifacts and continue normally.",
			onStatus: () => {},
			onEvent: () => {},
			invocation,
		});

		assert.equal(resumed.manifest.status, "success");
		assert.equal(resumed.resumeAnalysis.failureCategory, "bootstrap_failed");
		assert.equal(resumed.resumeAnalysis.canSkipBootstrap, false);
		assert.equal(resumed.manifest.completedLoops, 1);
		await fs.access(path.join(resumed.callDir, "DIRECTIVE.md"));

		console.log("✓ R2: resume flow rebuilds from bootstrap failure and completes");
	});

	// C7 now tracks refinement-artifact changes rather than project source changes.
	await withTempDir(async (dir) => {
		const statuses: string[] = [];

		const invocation = await createFakePiScript(dir);

		const result = await runIdeaRefinementWorkflow({
			cwd: dir,
			idea: "Test C7 refinement artifact snapshot",
			loops: 1,
			modelPattern: undefined,
			thinkingLevel: undefined,
			onStatus: (msg) => { if (msg) statuses.push(msg); },
			onEvent: () => {},
			invocation,
		});

		assert.equal(result.manifest.status, "success", "Workflow should succeed");

		const c7Warnings = statuses.filter((s) => s.includes("C7=0"));
		assert.equal(c7Warnings.length, 0, `Did not expect C7=0 warnings. Statuses: ${JSON.stringify(statuses)}`);

		const loop = result.manifest.loops[0];
		assert.ok(loop.c7Snapshot, "Loop should have c7Snapshot");
		assert.equal(loop.c7Snapshot!.hasChanges, true, "c7Snapshot should detect refinement artifact changes");
		assert.match(loop.c7Snapshot!.diffSummary, /RESPONSE\.md/);

		console.log("✓ C7: refinement artifact snapshot detects RESPONSE.md changes");
	});
}
