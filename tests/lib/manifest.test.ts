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
	manifestWriteCount,
	readManifest,
	resetManifestWriteCount,
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
			},
			callNumber: 1,
			requestedLoops: 3,
			model: "test-model",
			thinkingLevel: "high",
			assumptions: ["A1"],
		});
		assert.equal(manifest.schemaVersion, 2);
		assert.equal(manifest.status, "running");
		assert.equal(manifest.requestedLoops, 3);
		assert.equal(manifest.completedLoops, 0);
		assert.equal(manifest.model, "test-model");
		assert.equal(manifest.assumptions[0], "A1");
		assert.equal(manifest.bootstrap.status, "pending");
		assert.equal(manifest.loops.length, 0);
		assert.ok(manifest.files.idea.endsWith("IDEA.md"));
		assert.ok(manifest.auxiliaryFiles.guardAuditLog.endsWith("guard-denials.jsonl"));
		assert.deepEqual(manifest.rawAttemptPaths, { bootstrap: [], report: [], checklist: [] });
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
		assert.ok(loopEntry.backlogPath.includes("loop_01/BACKLOG.md"));
		assert.deepEqual(loopEntry.rawAttemptPaths, { develop: [], evaluate: [], learning: [] });
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
			},
			callNumber: 1,
			requestedLoops: 2,
			assumptions: [],
		});
		await saveManifest(manifestPath, manifest);
		const saved = JSON.parse(await fs.readFile(manifestPath, "utf8"));
		assert.equal(saved.status, "running");
		assert.equal(saved.schemaVersion, 2);
	});
	console.log("✓ saveManifest persists JSON correctly");

	await withTempDir(async (dir) => {
		const manifestPath = path.join(dir, "v1-run.json");
		await fs.writeFile(manifestPath, `${JSON.stringify({
			schemaVersion: 1,
			status: "failed",
			cwd: dir,
			callNumber: 7,
			callId: "artifacts_call_07",
			callDir: "docs/idea_refinement/artifacts_call_07",
			startedAt: new Date().toISOString(),
			requestedLoops: 1,
			completedLoops: 0,
			files: {
				idea: "docs/idea_refinement/artifacts_call_07/IDEA.md",
				directive: "docs/idea_refinement/artifacts_call_07/DIRECTIVE.md",
				learning: "docs/idea_refinement/artifacts_call_07/LEARNING.md",
				criteria: "docs/idea_refinement/artifacts_call_07/CRITERIA.md",
				diagnosis: "docs/idea_refinement/artifacts_call_07/DIAGNOSIS.md",
				metrics: "docs/idea_refinement/artifacts_call_07/METRICS.md",
				backlog: "docs/idea_refinement/artifacts_call_07/BACKLOG.md",
				response: "docs/idea_refinement/artifacts_call_07/RESPONSE.md",
				feedback: "docs/idea_refinement/artifacts_call_07/FEEDBACK.md",
				report: "docs/idea_refinement/artifacts_call_07/REPORT.md",
				checklist: "docs/idea_refinement/artifacts_call_07/CHECKLIST.md",
			},
			bootstrap: {
				name: "bootstrap",
				status: "success",
				logPath: "docs/idea_refinement/artifacts_call_07/logs/bootstrap.jsonl",
				stderrPath: "docs/idea_refinement/artifacts_call_07/logs/bootstrap.stderr.log",
			},
			report: {
				name: "report",
				status: "pending",
				logPath: "docs/idea_refinement/artifacts_call_07/logs/report.jsonl",
				stderrPath: "docs/idea_refinement/artifacts_call_07/logs/report.stderr.log",
			},
			checklist: {
				name: "checklist",
				status: "pending",
				logPath: "docs/idea_refinement/artifacts_call_07/logs/checklist.jsonl",
				stderrPath: "docs/idea_refinement/artifacts_call_07/logs/checklist.stderr.log",
			},
			loops: [{
				loopNumber: 1,
				randomNumber: 55,
				startedAt: new Date().toISOString(),
				responsePath: "docs/idea_refinement/artifacts_call_07/loops/loop_01/RESPONSE.md",
				feedbackPath: "docs/idea_refinement/artifacts_call_07/loops/loop_01/FEEDBACK.md",
				learningPath: "docs/idea_refinement/artifacts_call_07/loops/loop_01/LEARNING.md",
				stages: {
					develop: { name: "develop", status: "success", logPath: "docs/idea_refinement/artifacts_call_07/logs/loop_01_develop.jsonl", stderrPath: "docs/idea_refinement/artifacts_call_07/logs/loop_01_develop.stderr.log" },
					evaluate: { name: "evaluate", status: "success", logPath: "docs/idea_refinement/artifacts_call_07/logs/loop_01_evaluate.jsonl", stderrPath: "docs/idea_refinement/artifacts_call_07/logs/loop_01_evaluate.stderr.log" },
					learning: { name: "learning", status: "success", logPath: "docs/idea_refinement/artifacts_call_07/logs/loop_01_learning.jsonl", stderrPath: "docs/idea_refinement/artifacts_call_07/logs/loop_01_learning.stderr.log" },
				},
			}],
			assumptions: [],
		}, null, 2)}\n`, "utf8");

		const migrated = await readManifest(manifestPath);
		assert.equal(migrated.schemaVersion, 2);
		assert.ok(migrated.auxiliaryFiles.guardAuditLog.endsWith("guard-denials.jsonl"));
		assert.ok(migrated.loops[0]?.backlogPath.endsWith("loops/loop_01/BACKLOG.md"));
		assert.deepEqual(migrated.loops[0]?.rawAttemptPaths, { develop: [], evaluate: [], learning: [] });
	});
	console.log("✓ readManifest migrates schemaVersion 1 manifests with default governance fields");

	await withTempDir(async (dir) => {
		const manifestPath = path.join(dir, "invalid-run.json");
		await fs.writeFile(manifestPath, `${JSON.stringify({ status: "failed" }, null, 2)}\n`, "utf8");
		await assert.rejects(readManifest(manifestPath), /schemaVersion is required/);
	});
	console.log("✓ readManifest rejects manifests without schemaVersion");

	await withTempDir(async (dir) => {
		const manifestPath = path.join(dir, "future-run.json");
		await fs.writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 999, status: "failed", cwd: dir, callNumber: 1, callId: "artifacts_call_01", callDir: "docs/idea_refinement/artifacts_call_01", startedAt: new Date().toISOString(), requestedLoops: 1, completedLoops: 0, files: {}, bootstrap: {}, report: {}, checklist: {}, loops: [], assumptions: [] }, null, 2)}\n`, "utf8");
		await assert.rejects(readManifest(manifestPath), /schemaVersion 999 is newer than supported 2/);
	});
	console.log("✓ readManifest rejects unsupported future schema versions");

	// B19: Test resetManifestWriteCount resets counter to 0
	await withTempDir(async (dir) => {
		const manifestPath = path.join(dir, "manifest-test.json");
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
			},
			callNumber: 1,
			requestedLoops: 2,
			assumptions: [],
		});

		// Record baseline counter before test
		const baseline = manifestWriteCount;

		// Accumulate writes
		await saveManifest(manifestPath, manifest);
		await saveManifest(manifestPath, manifest);
		await saveManifest(manifestPath, manifest);
		assert.ok(manifestWriteCount >= baseline + 3, `Expected counter >= ${baseline + 3}, got ${manifestWriteCount}`);

		// Reset and verify
		resetManifestWriteCount();
		assert.equal(manifestWriteCount, 0, `Expected counter = 0 after reset, got ${manifestWriteCount}`);

		// Verify idempotency: reset again should still be 0
		resetManifestWriteCount();
		assert.equal(manifestWriteCount, 0, "resetManifestWriteCount should be idempotent");
	});
	console.log("✓ B19: resetManifestWriteCount resets counter to 0 (functional test)");
}
