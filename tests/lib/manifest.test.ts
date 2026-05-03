import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
	createStageRecord,
	createInitialManifest,
	createLoopEntry,
	markStageRunning,
	markStageSuccess,
	markStageFailure,
	saveManifest,
} from "../../lib/manifest.ts";
import type { StageExecutionResult } from "../../lib/types.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

export async function run(): Promise<void> {
	const record = createStageRecord("bootstrap", "logs/bootstrap.jsonl", "logs/bootstrap.stderr.log");
	assert.equal(record.name, "bootstrap");
	assert.equal(record.status, "pending");
	assert.equal(record.logPath, "logs/bootstrap.jsonl");
	assert.equal(record.startedAt, undefined);
	console.log("✓ createStageRecord initializes record correctly");

	markStageRunning(record);
	assert.equal(record.status, "running");
	assert.ok(record.startedAt);
	assert.equal(record.completedAt, undefined);
	console.log("✓ markStageRunning transitions to running");

	const result: StageExecutionResult = {
		text: "ok",
		exitCode: 0,
		stderr: "",
		model: "test-model",
		stopReason: "stop",
		usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, contextTokens: 15 },
	};
	markStageSuccess(record, result);
	assert.equal(record.status, "success");
	assert.ok(record.completedAt);
	assert.equal(record.model, "test-model");
	assert.equal(record.usage?.turns, 1);
	console.log("✓ markStageSuccess records result correctly");

	const failRecord = createStageRecord("develop", "logs/dev.jsonl", "logs/dev.stderr.log");
	markStageFailure(failRecord, new Error("stage failed"));
	assert.equal(failRecord.status, "failed");
	assert.equal(failRecord.errorMessage, "stage failed");
	console.log("✓ markStageFailure records error correctly");

	await withTempDir(async (dir) => {
		const manifest = createInitialManifest({
			cwd: dir,
			workspace: {
				baseDir: path.join(dir, "docs", "idea_refinement"),
				callDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01"),
				logsDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "logs"),
				loopsDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "loops"),
				rootFiles: {
					idea: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "IDEA.md"),
					directive: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "DIRECTIVE.md"),
					learning: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "LEARNING.md"),
					criteria: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "CRITERIA.md"),
					diagnosis: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "DIAGNOSIS.md"),
					metrics: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "METRICS.md"),
					backlog: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "BACKLOG.md"),
					response: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "RESPONSE.md"),
					feedback: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "FEEDBACK.md"),
					manifest: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "RUN.json"),
					report: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "REPORT.md"),
					checklist: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "CHECKLIST.md"),
				},
			},
			callNumber: 1,
			requestedLoops: 3,
			model: "test-model",
			thinkingLevel: "high",
			assumptions: ["A1"],
		});
		assert.equal(manifest.schemaVersion, 1);
		assert.equal(manifest.status, "running");
		assert.equal(manifest.requestedLoops, 3);
		assert.equal(manifest.completedLoops, 0);
		assert.equal(manifest.model, "test-model");
		assert.equal(manifest.assumptions[0], "A1");
		assert.equal(manifest.bootstrap.status, "pending");
		assert.equal(manifest.loops.length, 0);
		assert.ok(manifest.files.idea.endsWith("IDEA.md"));
	});
	console.log("✓ createInitialManifest creates complete structure");

	await withTempDir(async (dir) => {
		const loopEntry = createLoopEntry({
			cwd: dir,
			loopNumber: 1,
			randomNumber: 42,
			loopDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "loops", "loop_01"),
			logsDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "logs"),
		});
		assert.equal(loopEntry.loopNumber, 1);
		assert.equal(loopEntry.randomNumber, 42);
		assert.equal(loopEntry.stages.develop.status, "pending");
		assert.equal(loopEntry.stages.evaluate.status, "pending");
		assert.equal(loopEntry.stages.learning.status, "pending");
		assert.ok(loopEntry.responsePath.includes("loop_01/RESPONSE.md"));
	});
	console.log("✓ createLoopEntry creates loop entry correctly");

	await withTempDir(async (dir) => {
		const manifestPath = path.join(dir, "manifest.json");
		const manifest = createInitialManifest({
			cwd: dir,
			workspace: {
				baseDir: path.join(dir, "docs", "idea_refinement"),
				callDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01"),
				logsDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "logs"),
				loopsDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "loops"),
				rootFiles: {
					idea: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "IDEA.md"),
					directive: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "DIRECTIVE.md"),
					learning: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "LEARNING.md"),
					criteria: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "CRITERIA.md"),
					diagnosis: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "DIAGNOSIS.md"),
					metrics: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "METRICS.md"),
					backlog: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "BACKLOG.md"),
					response: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "RESPONSE.md"),
					feedback: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "FEEDBACK.md"),
					manifest: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "RUN.json"),
					report: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "REPORT.md"),
					checklist: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "CHECKLIST.md"),
				},
			},
			callNumber: 1,
			requestedLoops: 2,
			assumptions: [],
		});
		await saveManifest(manifestPath, manifest);
		const saved = JSON.parse(await fs.readFile(manifestPath, "utf8"));
		assert.equal(saved.status, "running");
		assert.equal(saved.schemaVersion, 1);
	});
	console.log("✓ saveManifest persists JSON correctly");
}
