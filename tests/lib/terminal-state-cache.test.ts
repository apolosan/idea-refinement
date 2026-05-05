import assert from "node:assert/strict";
import { terminalStateCache, clearTerminalStateCache } from "../../lib/terminal-state-cache.ts";

export async function run(): Promise<void> {
	// Ensure clean state before tests
	clearTerminalStateCache();

	// B20: Test .has on empty cache returns false
	assert.equal(terminalStateCache.has("/nonexistent"), false);
	console.log("✓ terminalStateCache.has returns false for missing key");

	// B20: Test .add and .has
	terminalStateCache.add("/root/a");
	assert.equal(terminalStateCache.has("/root/a"), true);
	assert.equal(terminalStateCache.has("/root/b"), false);
	console.log("✓ terminalStateCache.add populates cache correctly");

	// B20: Test .delete
	terminalStateCache.delete("/root/a");
	assert.equal(terminalStateCache.has("/root/a"), false);
	console.log("✓ terminalStateCache.delete removes entry");

	// B20: Test .delete on non-existent key does not throw
	terminalStateCache.delete("/nonexistent");
	console.log("✓ terminalStateCache.delete is safe on missing key");

	// B20: Test clearTerminalStateCache
	terminalStateCache.add("/root/x");
	terminalStateCache.add("/root/y");
	assert.equal(terminalStateCache.size, 2);
	clearTerminalStateCache();
	assert.equal(terminalStateCache.size, 0);
	assert.equal(terminalStateCache.has("/root/x"), false);
	assert.equal(terminalStateCache.has("/root/y"), false);
	console.log("✓ clearTerminalStateCache resets entire cache");

	// B20: Test idempotent add
	terminalStateCache.add("/root/z");
	terminalStateCache.add("/root/z");
	assert.equal(terminalStateCache.size, 1);
	console.log("✓ terminalStateCache.add is idempotent (Set behavior)");

	// Cleanup
	clearTerminalStateCache();
}
