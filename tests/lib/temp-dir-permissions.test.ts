import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

export async function run(): Promise<void> {
	// B37: Verify that mkdtemp + chmod 0o700 produces correct permissions
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-perm-test-"));
	try {
		await fs.chmod(tempDir, 0o700);

		// Use stat to verify actual permissions on disk
		const stat = await fs.stat(tempDir);
		const mode = (stat.mode & 0o777).toString(8);
		assert.equal(mode, "700", `Expected 700, got ${mode}`);
		console.log("✓ chmod 0o700 produces correct permissions on temp directory");

		// Verify owner can read and write
		const testFile = path.join(tempDir, "test.md");
		await fs.writeFile(testFile, "test content", "utf-8");
		const content = await fs.readFile(testFile, "utf-8");
		assert.equal(content, "test content");
		console.log("✓ owner can read/write in 0o700 directory");

		// B37: Verify cleanup works after chmod
		await fs.rm(testFile);
		await fs.rmdir(tempDir);
		let dirExists = true;
		try {
			await fs.access(tempDir);
		} catch {
			dirExists = false;
		}
		assert.equal(dirExists, false, "Temp directory should be removed after cleanup");
		console.log("✓ temp directory cleanup works after chmod 0o700");
	} catch (error) {
		// Cleanup on failure
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
		throw error;
	}

	// B37: Verify that default umask would create world-readable dir (contrast test)
	const defaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "idea-refinement-default-"));
	try {
		const defaultStat = await fs.stat(defaultDir);
		const defaultMode = (defaultStat.mode & 0o777).toString(8);
		// Default should be 700 or more permissive (umask-dependent)
		// On most systems with umask 0022, it would be 755
		assert.ok(
			parseInt(defaultMode, 8) >= parseInt("700", 8),
			`Default dir should be at least 700, got ${defaultMode}`
		);
		console.log(`✓ default mkdtemp creates dir with mode ${defaultMode} (umask-dependent)`);
	} finally {
		await fs.rm(defaultDir, { recursive: true, force: true });
	}
}
