/**
 * post-hoc-check.ts — Snapshot SHA256 do diretório de código fonte
 * 
 * Propósito: Detectar se um loop "develop" realmente alterou arquivos .ts
 * da extensão, provendo evidência material de execução vs. pseudo-execução.
 * 
 * Mecanismo:
 * 1. Antes do develop: tira snapshot SHA256 de todos os .ts no diretório
 * 2. Depois do develop: tira novo snapshot e compara
 * 3. Retorna lista de arquivos alterados (ou vazia se nenhum)
 * 
 * Isto alimenta o critério C7 (Execução Material) do FEEDBACK.md.
 */

import { createHash } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

export interface FileSnapshot {
	[relativePath: string]: string; // SHA256 hex digest
}

export interface SnapshotDiff {
	changed: string[];       // arquivos com hash diferente
	added: string[];         // arquivos novos
	removed: string[];       // arquivos que sumiram
	hasChanges: boolean;     // true se changed + added + removed > 0
}

/**
 * Tira snapshot SHA256 dos arquivos .ts do diretório raiz da extensão.
 * Retorna um mapa de caminho relativo → hash.
 * Se o diretório não existir, retorna objeto vazio.
 */
export async function takeSnapshot(extensionRoot: string): Promise<FileSnapshot> {
	const snapshot: FileSnapshot = {};

	try {
		await fs.access(extensionRoot);
	} catch {
		return snapshot;
	}

	async function walkDir(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
				await walkDir(fullPath);
			} else if (entry.isFile() && entry.name.endsWith(".ts")) {
				const relPath = path.relative(extensionRoot, fullPath);
				try {
					const content = await fs.readFile(fullPath, "utf-8");
					snapshot[relPath] = createHash("sha256").update(content, "utf-8").digest("hex");
				} catch {
					// skip unreadable files
				}
			}
		}
	}

	await walkDir(extensionRoot);
	return snapshot;
}

/**
 * Compara dois snapshots e retorna as diferenças.
 */
export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): SnapshotDiff {
	const changed: string[] = [];
	const added: string[] = [];
	const removed: string[] = [];

	const allFiles = new Set([...Object.keys(before), ...Object.keys(after)]);

	for (const file of allFiles) {
		const beforeHash = before[file];
		const afterHash = after[file];

		if (beforeHash && !afterHash) {
			removed.push(file);
		} else if (!beforeHash && afterHash) {
			added.push(file);
		} else if (beforeHash && afterHash && beforeHash !== afterHash) {
			changed.push(file);
		}
	}

	return {
		changed,
		added,
		removed,
		hasChanges: changed.length > 0 || added.length > 0 || removed.length > 0,
	};
}

/**
 * Formata o diff para inclusão em notificação/diagnóstico.
 */
export function formatSnapshotDiff(diff: SnapshotDiff): string {
	const parts: string[] = [];

	if (diff.changed.length > 0) {
		parts.push(`alterados (${diff.changed.length}): ${diff.changed.join(", ")}`);
	}
	if (diff.added.length > 0) {
		parts.push(`adicionados (${diff.added.length}): ${diff.added.join(", ")}`);
	}
	if (diff.removed.length > 0) {
		parts.push(`removidos (${diff.removed.length}): ${diff.removed.join(", ")}`);
	}

	if (parts.length === 0) {
		return "Nenhuma alteração material detectada no código fonte.";
	}

	return parts.join("; ");
}
