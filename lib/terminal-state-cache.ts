/**
 * In-memory cache for protected roots known to be in a terminal workflow state.
 * Populated by flushManifest when writing terminal manifests;
 * consulted by artifact-guard to avoid synchronous file reads on hot paths.
 */

export const terminalStateCache = new Set<string>();

export function clearTerminalStateCache(): void {
	terminalStateCache.clear();
}
