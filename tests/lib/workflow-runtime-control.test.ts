import assert from "node:assert/strict";
import { WorkflowRuntimeControl } from "../../lib/workflow-runtime-control.ts";

export async function run(): Promise<void> {
	const control = new WorkflowRuntimeControl();
	assert.equal(control.isRunActive(), false);
	assert.equal(control.getElapsedMs(), 0);

	control.startRun();
	assert.equal(control.isRunActive(), true);
	assert.equal(control.isPaused(), false);

	let paused = 0;
	let resumed = 0;
	let stopped = 0;
	const handle = {
		pause: () => { paused++; },
		resume: () => { resumed++; },
		stop: () => { stopped++; },
	};
	control.attachProcess(handle);

	const pauseResult = control.togglePause();
	assert.equal(pauseResult.paused, true);
	assert.equal(control.isPaused(), true);
	assert.equal(paused, 1);

	const resumeResult = control.togglePause();
	assert.equal(resumeResult.paused, false);
	assert.equal(control.isPaused(), false);
	assert.equal(resumed, 1);

	const stopResult = control.requestStop("stop requested");
	assert.match(stopResult.message, /stop requested/);
	assert.equal(control.isStopRequested(), true);
	assert.equal(stopped, 1);
	assert.throws(() => control.ensureNotStopped(), /stop requested/);

	control.finishRun();
	assert.equal(control.isRunActive(), false);
	assert.equal(control.isStopRequested(), false);
	assert.equal(control.isPaused(), false);
	console.log("✓ workflow-runtime-control tracks pause, resume, stop, and elapsed state");
}
