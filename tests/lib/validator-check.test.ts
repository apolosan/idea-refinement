import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { runResponseValidatorCheck } from "../../lib/validator-check.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

export async function run(): Promise<void> {
	await withTempDir(async (dir) => {
		const responsePath = path.join(dir, "RESPONSE.md");
		const text = [
			"# Response",
			"## Enquadramento do loop",
			"Content here with enough length to satisfy the minimum line count requirement for validation purposes.",
			"## Diagnóstico focal deste loop",
			"[FATO] File reference: src/index.ts",
			"[FATO] Another fact: lib/utils.ts",
			"## Matriz mínima de alternativas",
			"| Alt | Problema | Mecanismo | Benefício | Custo | Risco |",
			"|-----|----------|-----------|-----------|-------|-------|",
			"| A   | X        | Y         | Z         | Low   | None  |",
			"| B   | X2       | Y2        | Z2        | High  | Some  |",
			"## Estado atual vs. estado proposto",
			"antes: baseline 50ms, depois: target 30ms (40% improvement)",
			"## Decisão desta iteração",
			"Manter a abordagem atual e Ajustar parâmetros.",
			"## Descartes explícitos desta iteração",
			"Descartar alternativa C por custo excessivo.",
			"## Próximos focos",
			"Testar depois a integração com módulo externo.",
			"[INFERÊNCIA] Based on data.",
			"[RISCO] Potential failure.",
		].join("\n");
		await fs.writeFile(responsePath, text, "utf-8");
		await runResponseValidatorCheck(responsePath);

		// C3 fix: output is now written in the same dir as RESPONSE.md
		const expectedPath = path.join(dir, "validator-check-output.md");
		assert.equal(existsSync(expectedPath), true);
		const output = readFileSync(expectedPath, "utf-8");
		assert.match(output, /Validator Check/);
		assert.match(output, /PASS/);
	});
	console.log("✓ runResponseValidatorCheck gera relatório para resposta válida");

	await withTempDir(async (dir) => {
		const missingPath = path.join(dir, "MISSING.md");
		await runResponseValidatorCheck(missingPath);
		const expectedPath = path.join(dir, "validator-check-output.md");
		assert.equal(existsSync(expectedPath), false);
	});
	console.log("✓ runResponseValidatorCheck ignora arquivo inexistente");
}
