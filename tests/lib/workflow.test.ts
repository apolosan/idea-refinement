import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runIdeaRefinementWorkflow } from "../../lib/workflow.ts";

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
		`if (sp.includes("artefatos iniciais")) {`,
		`  r = [tag("DIRECTIVE.md","# Dir\\nSelected Policy: OPTIMIZATION\\n## OPT\\nFocus on measurable improvement.\\n## CREAT\\nExplore novel approaches."),`,
		`       tag("LEARNING.md","# Learn\\n[HYP] First entry."),`,
		`       tag("CRITERIA.md","# Crit\\n## V\\nBefore/after with metrics."),`,
		`       tag("DIAGNOSIS.md","# Diag\\n[FATO] Initial assessment.\\n[INF] Key inference.\\n## Current vs Proposed\\nCurrent: unvalidated. Proposed: structured."),`,
		`       tag("METRICS.md","# Met\\n## M1\\n- Scale: 1-10\\n- Baseline: 3/10\\n- Target: 7/10"),`,
		`       tag("BACKLOG.md","# BL\\n|ID|P|S|D|\\n|---|---|---|---|\\n|B1|P0|pend|Validate|\\n|B2|P1|pend|Explore|")`,
		`  ].join("\\n");`,
		`} else if (sp.includes("desenvolvimento iterativo da ideia")) {`,
		`  r = ["# Response","## Enquadramento do loop","Analyzing focus.","## Diagnóstico focal deste loop",`,
		`       "[FATO] Evidence: src/index.ts.","[FATO] More: lib/workflow.ts.","## Perguntas operacionais e pesquisa externa aplicada","What to measure?",`,
		`       "## Matriz mínima de alternativas","|Alt|P|M|B|C|R|","|---|---|---|---|---|---|","|A|X|Y|Z|L|N|","|B|X2|Y2|Z2|M|S|","|C|X3|Y3|Z3|H|Ma|",`,
		`       "## Estado atual vs. estado proposto","antes: baseline 5/10, depois: target 7/10 (40% improvement)",`,
		`       "## Protocolo de experimento","Run tests.","## Decisão desta iteração","Manter A. Ajustar B.",`,
		`       "## Descartes explícitos desta iteração","Descartar C.","## Próximos focos","Testar depois.",`,
		`       "[INFERÊNCIA] Bottleneck identified.","[RISCO] Over-engineering risk."`,
		`  ].join("\\n");`,
		`} else if (sp.includes("avaliador da etapa") || sp.includes("Scoreboard")) {`,
		`  r = ["# Feedback","## Veredito geral","Solid.","## Evidências que sustentam o veredito","[FATO] Template.",`,
		`       "## Avaliação da comparabilidade antes/depois","Before: x. After: y.","## Auditoria epistêmica","Tags ok.",`,
		`       "## Avaliação critério a critério","Pass.","## Decisão final da iteração","Manter.",`,
		`       "## Recomendações objetivas para a próxima iteração","Evidence.","## Scoreboard",`,
		`       "Process Rigor score: 72/100","Material Result score: 68/100","Overall score: 70/100"`,
		`  ].join("\\n");`,
		`} else if (sp.includes("curador da base de aprendizado")) {`,
		`  r = [tag("LEARNING.md","# Learn\\n[HYP] Works.\\n[DECISÃO] Maintain."),`,
		`       tag("BACKLOG.md","# BL\\n|ID|P|S|D|\\n|---|---|---|---|\\n|B1|P0|done|X|\\n|B2|P1|pend|Y|\\n|B3|P2|new|Z|")`,
		`  ].join("\\n");`,
		`} else if (sp.includes("consolidar todo o processo") || sp.includes("Relatório de Investigação")) {`,
		`  r = ["# Relatório de Investigação","## Resumo executivo","Done.","## Contexto e objeto da investigação","Analyzed.",`,
		`       "## Metodologia aplicada","Iterative.","## Descobertas principais","[FATO] Findings.",`,
		`       "## Evolução dos scores","70/100.","## Decisões firmes e hipóteses ativas","[DECISÃO] OK.",`,
		`       "## Riscos identificados e mitigações","[RISCO] Complex.","## Recomendações finais","Proceed.",`,
		`       "## Referências cruzadas","All."`,
		`  ].join("\\n");`,
		`} else if (sp.includes("lista de ações") || sp.includes("Checklist de Ações")) {`,
		`  r = ["# Checklist de Ações","## Ações imediatas (P0)","- Validate [DECISÃO]",`,
		`       "## Ações de curto prazo (P1)","- Implement","## Ações de médio prazo (P2)","- Monitor",`,
		`       "## Ações de longo prazo (P3)","- Scale","## Dependências entre ações","P0->P1.",`,
		`       "## Critérios de aceite por ação","Measurable."`,
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

		// Verifica arquivos criados (manifest stores relative paths, resolve against dir)
		for (const filePath of Object.values(result.manifest.files)) {
			await fs.access(path.resolve(dir, filePath));
		}
		await fs.access(path.join(result.callDir, "run.json"));

		// C1 fix: Verify report and checklist stages are properly tracked
		assert.equal(result.manifest.report.status, "success");
		assert.equal(result.manifest.checklist.status, "success");

		// Verifica estrutura do loop
		assert.equal(result.manifest.loops.length, 1);
		const loop = result.manifest.loops[0];
		assert.equal(loop.loopNumber, 1);
		assert.ok(loop.randomNumber >= 1 && loop.randomNumber <= 100);
		assert.ok(loop.stages.develop.status === "success" || loop.stages.develop.status === "failed");
		assert.ok(loop.stages.evaluate.status === "success" || loop.stages.evaluate.status === "failed");
		assert.ok(loop.stages.learning.status === "success" || loop.stages.learning.status === "failed");

		// Verifica eventos
		assert.ok(events.includes("workflow_started"));
		assert.ok(events.includes("workflow_completed") || events.includes("workflow_failed"));
		console.log("✓ runIdeaRefinementWorkflow executa workflow completo com 1 loop");
	});
}
