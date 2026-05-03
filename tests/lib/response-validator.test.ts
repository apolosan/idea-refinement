import assert from "node:assert/strict";
import { validateResponse } from "../../lib/response-validator.ts";

function buildValidResponse(): string {
	return [
		"# Response",
		"## Enquadramento do loop",
		"Content here with enough length to satisfy the minimum line count requirement for validation purposes.",
		"## Diagnóstico focal deste loop",
		"[FATO] File reference: src/index.ts",
		"[FATO] Another fact: lib/utils.ts",
		"## Perguntas operacionais e pesquisa externa aplicada",
		"Some questions here to add more lines to the document for validation.",
		"## Matriz mínima de alternativas",
		"| Alt | Problema | Mecanismo | Benefício | Custo | Risco |",
		"|-----|----------|-----------|-----------|-------|-------|",
		"| A   | X        | Y         | Z         | Low   | None  |",
		"| B   | X2       | Y2        | Z2        | High  | Some  |",
		"## Estado atual vs. estado proposto",
		"antes: baseline 50ms, depois: target 30ms (40% improvement)",
		"## Protocolo de experimento",
		"Steps to execute the experiment properly with clear metrics.",
		"## Decisão desta iteração",
		"Manter a abordagem atual e Ajustar parâmetros.",
		"## Descartes explícitos desta iteração",
		"Descartar alternativa C por custo excessivo.",
		"## Próximos focos",
		"Testar depois a integração com módulo externo.",
		"[INFERÊNCIA] Based on the data collected so far.",
		"[RISCO] Potential failure in edge cases.",
	].join("\n");
}

export async function run(): Promise<void> {
	const valid = validateResponse(buildValidResponse());
	assert.equal(valid.passed, true);
	assert.ok(valid.score >= 60);
	assert.ok(valid.checks.length >= 8);
	console.log("✓ validateResponse aprova resposta válida");

	const empty = validateResponse("");
	assert.equal(empty.passed, false);
	assert.ok(empty.score < 60);
	console.log("✓ validateResponse rejeita resposta vazia");

	const noTags = validateResponse("x\n".repeat(60));
	assert.equal(noTags.passed, false);
	console.log("✓ validateResponse rejeita resposta sem tags epistêmicas");

	const withAdotar = validateResponse(buildValidResponse().replace("Manter", "Adotar"));
	const adotarCheck = withAdotar.checks.find((c) => c.name.includes("Adotar"));
	assert.equal(adotarCheck?.passed, false);
	console.log("✓ validateResponse detecta uso proibido de 'Adotar'");

	const noSections = validateResponse("[FATO] ref\n".repeat(60));
	const sectionChecks = noSections.checks.filter((c) => c.name.startsWith("C2:"));
	assert.ok(sectionChecks.some((c) => !c.passed));
	console.log("✓ validateResponse verifica seções obrigatórias");
}
