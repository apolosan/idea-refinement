import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createIdeaRefinementExtension, type IdeaRefinementExtensionDeps } from "../../index.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-tests-"));
	try {
		await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function createMockPi(thinkingLevel = "medium") {
	const commands = new Map<string, (args: string, ctx: any) => Promise<void> | void>();
	return {
		registerCommand: (name: string, options: { handler: (args: string, ctx: any) => Promise<void> | void }) => {
			commands.set(name, options.handler);
		},
		registerShortcut: () => {},
		getThinkingLevel: () => thinkingLevel,
		commands,
		getCommand(name: string) {
			const handler = commands.get(name);
			assert.ok(handler, `Expected command ${name} to be registered`);
			return handler!;
		},
	};
}

function createMockContext(options: {
	cwd: string;
	inputs?: string[];
	confirms?: boolean[];
	editorValues?: Array<string | undefined>;
	model?: { provider: string; id: string };
}) {
	const inputs = [...(options.inputs ?? [])];
	const confirms = [...(options.confirms ?? [])];
	const editorValues = [...(options.editorValues ?? [])];
	const notifications: Array<{ message: string; level: string }> = [];
	const confirmCalls: Array<{ title: string; message: string }> = [];

	const ctx = {
		cwd: options.cwd,
		hasUI: true,
		model: options.model ?? { provider: "provider", id: "model" },
		isIdle: () => true,
		ui: {
			editor: async () => editorValues.shift(),
			input: async () => inputs.shift(),
			confirm: async (title: string, message: string) => {
				confirmCalls.push({ title, message });
				return confirms.shift() ?? false;
			},
			notify: (message: string, level: string) => {
				notifications.push({ message, level });
			},
			setStatus: () => {},
			setWidget: () => {},
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			theme: {
				fg: (_color: string, text: string) => text,
			},
		},
	};

	return { ctx, notifications, confirmCalls };
}

function createWorkflowResult(cwd: string, callName = "artifacts_call_01"): any {
	const callDir = path.join(cwd, "docs", "idea_refinement", callName);
	return {
		callDir,
		relativeCallDir: `docs/idea_refinement/${callName}`,
		manifest: {
			status: "success",
			requestedLoops: 1,
			completedLoops: 1,
			bootstrap: { status: "success" },
			report: { status: "success" },
			checklist: { status: "success" },
			loops: [],
		},
		latestScore: 70,
	};
}

export async function run(): Promise<void> {
	await withTempDir(async (dir) => {
		let capturedInput: any;
		const deps: IdeaRefinementExtensionDeps = {
			analyzeFailedRunForResume: async () => { throw new Error("not used"); },
			runIdeaRefinementResumeWorkflow: async () => { throw new Error("not used"); },
			runIdeaRefinementWorkflow: async (input) => {
				capturedInput = input;
				return createWorkflowResult(dir) as any;
			},
			runResponseValidatorCheck: async () => {},
		};
		const pi = createMockPi("high");
		createIdeaRefinementExtension(deps)(pi as any);
		const handler = pi.getCommand("idea-refine");
		const { ctx } = createMockContext({ cwd: dir, inputs: ["2"] });

		await handler("Investigate governance hardening", ctx);

		assert.equal(capturedInput?.thinkingLevel, "high");
		assert.equal(capturedInput?.modelPattern, "provider/model");
		assert.equal(capturedInput?.loops, 2);
		console.log("✓ idea-refine forwards the current thinking level into workflow execution");
	});

	await withTempDir(async (dir) => {
		let capturedInput: any;
		const deps: IdeaRefinementExtensionDeps = {
			analyzeFailedRunForResume: async () => { throw new Error("not used"); },
			runIdeaRefinementResumeWorkflow: async () => { throw new Error("not used"); },
			runIdeaRefinementWorkflow: async (input) => {
				capturedInput = input;
				return createWorkflowResult(dir, "artifacts_call_02") as any;
			},
			runResponseValidatorCheck: async () => {},
		};
		const pi = createMockPi("medium");
		createIdeaRefinementExtension(deps)(pi as any);
		const handler = pi.getCommand("idea-refine");
		const { ctx, notifications, confirmCalls } = createMockContext({ cwd: dir, inputs: ["25", "3"], confirms: [false] });

		await handler("Stress test loop count confirmation", ctx);

		assert.equal(confirmCalls.length, 1);
		assert.equal(capturedInput?.loops, 3);
		assert.ok(notifications.some((entry) => entry.message.includes("not confirmed")));
		console.log("✓ idea-refine requires explicit confirmation for unusually large loop counts");
	});

	await withTempDir(async (dir) => {
		let capturedResumeInput: any;
		const deps: IdeaRefinementExtensionDeps = {
			analyzeFailedRunForResume: async () => ({
				sourceCallDir: path.join(dir, "docs", "idea_refinement", "artifacts_call_01"),
				sourceRelativeCallDir: "docs/idea_refinement/artifacts_call_01",
				sourceManifestPath: path.join(dir, "docs", "idea_refinement", "artifacts_call_01", "run.json"),
				sourceManifest: {
					callId: "artifacts_call_01",
					requestedLoops: 2,
					status: "failed",
				},
				failureCategory: "loop_evaluate_failed",
				lastConsistentLoop: 1,
				lastConsistentScore: 70,
				bootstrapConsistent: true,
				failedLoopNumber: 2,
				recommendedStartLoop: 2,
				canSkipBootstrap: true,
				failureReason: "Synthetic failure",
				missingArtifacts: [],
			}) as any,
			runIdeaRefinementResumeWorkflow: async (input) => {
				capturedResumeInput = input;
				return {
					...createWorkflowResult(dir, "artifacts_call_03"),
					resumeAnalysis: await deps.analyzeFailedRunForResume(dir, "1"),
				} as any;
			},
			runIdeaRefinementWorkflow: async () => { throw new Error("not used"); },
			runResponseValidatorCheck: async () => {},
		};
		const pi = createMockPi("xhigh");
		createIdeaRefinementExtension(deps)(pi as any);
		const handler = pi.getCommand("idea-refine-resume");
		const { ctx } = createMockContext({ cwd: dir, inputs: ["2"], editorValues: ["Apply the proven workaround."] });

		await handler("1", ctx);

		assert.equal(capturedResumeInput?.thinkingLevel, "xhigh");
		assert.equal(capturedResumeInput?.finalLoopCount, 2);
		assert.equal(capturedResumeInput?.sourceCallSpecifier, "1");
		console.log("✓ idea-refine-resume forwards the current thinking level into resumed workflow execution");
	});
}
