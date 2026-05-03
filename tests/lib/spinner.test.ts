import assert from "node:assert/strict";
import { Spinner } from "../../lib/spinner.ts";

export async function run(): Promise<void> {
	// Test 1: Spinner starts and calls onFrame
	let frameCount = 0;
	let lastFrame = "";
	let lastMessage: string | undefined;
	const spinner = new Spinner({
		intervalMs: 20,
		onFrame: (frame, message) => {
			frameCount++;
			lastFrame = frame;
			lastMessage = message;
		},
		useUnicode: true,
	});

	assert.equal(spinner.running, false);
	spinner.start("test message");
	assert.equal(spinner.running, true);
	assert.equal(lastMessage, "test message");
	assert.ok(lastFrame.length > 0);
	console.log("✓ Spinner starts and calls onFrame with message");

	// Test 2: Spinner rotates Unicode frames
	const initialFrame = lastFrame;
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.ok(frameCount >= 2, `Expected at least 2 frames, got ${frameCount}`);
	assert.notEqual(lastFrame, initialFrame, "Frame should have rotated");
	console.log("✓ Spinner rotates Unicode frames over time");

	// Test 3: Update changes message without stopping
	spinner.update("updated message");
	assert.equal(spinner.running, true);
	assert.equal(lastMessage, "updated message");
	console.log("✓ Spinner update changes message while running");

	// Test 4: Stop clears interval and stops rotation
	spinner.stop();
	assert.equal(spinner.running, false);
	const countAfterStop = frameCount;
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(frameCount, countAfterStop, "Frame count should not increase after stop");
	console.log("✓ Spinner stops and ceases frame updates");

	// Test 5: Double start is a no-op
	let callCount = 0;
	const spinner2 = new Spinner({
		intervalMs: 20,
		onFrame: () => { callCount++; },
		useUnicode: true,
	});
	spinner2.start("first");
	const countAfterFirst = callCount;
	spinner2.start("second");
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.ok(callCount > countAfterFirst, "Spinner should continue after double start");
	spinner2.stop();
	console.log("✓ Double start is a no-op; original interval preserved");

	// Test 6: ASCII fallback
	let asciiFrame = "";
	const asciiSpinner = new Spinner({
		intervalMs: 20,
		onFrame: (frame) => { asciiFrame = frame; },
		useUnicode: false,
	});
	asciiSpinner.start();
	assert.ok(["|", "/", "-", "\\"].includes(asciiFrame), `ASCII frame should be one of |/-\\, got ${asciiFrame}`);
	asciiSpinner.stop();
	console.log("✓ ASCII fallback uses |/-\\ frames");

	// Test 7: Update on stopped spinner auto-starts
	let autoStartFrame = "";
	const spinner3 = new Spinner({
		intervalMs: 20,
		onFrame: (frame) => { autoStartFrame = frame; },
		useUnicode: false,
	});
	assert.equal(spinner3.running, false);
	spinner3.update("auto-start");
	assert.equal(spinner3.running, true);
	assert.equal(autoStartFrame, "|");
	spinner3.stop();
	console.log("✓ Update on stopped spinner auto-starts");

	// Test 8: Messageless start shows only frame
	let bareFrame = "";
	const spinner4 = new Spinner({
		intervalMs: 20,
		onFrame: (frame, message) => {
			bareFrame = frame;
			assert.equal(message, undefined);
		},
		useUnicode: true,
	});
	spinner4.start();
	assert.ok(bareFrame.length > 0);
	spinner4.stop();
	console.log("✓ Spinner works without message");
}
