Considere a melhoria/otimização das sugestões a seguir (exceto questões relacionadas à geração de número aleatório, NÃO TOQUE/ALTERE essa parte!):

# Performance Audit Report — @apolosan/idea-refinement

> **Date:** 2026-05-03  
> **Scope:** Full codebase scan for latency bottlenecks, redundant work, and architectural drag that slows loop execution.  
> **Impact goal:** Reduce per-loop wall-clock time and total workflow duration.

---

## Executive Summary

The single biggest drag on speed is **architectural**: every workflow stage (`bootstrap`, `develop`, `evaluate`, `learning`, `report`, `checklist`) spawns a **brand-new `pi` subprocess** with cold-start overhead (model load, extension init, system-prompt parse). A 3-loop workflow creates **1 + (3 × 3) + 2 = 12** separate subprocess invocations. There is no caching, no prompt deduplication, and no parallelization of independent work. File I/O is also a choke-point: the manifest is rewritten to disk **~20× per run**, and the C7 snapshot walks the **entire project tree** before/after every `develop` stage.

Below is the complete ranked list of issues, from highest to lowest impact, with concrete remediation strategies.

---

## 1. Subprocess Cold-Start Tax (CRITICAL — ~60-80 % of loop time)

### Problem
`runner.ts` calls `spawn()` for every stage. Each subprocess:
1. Boots the Pi runtime.
2. Loads the model (provider handshake, context-window alloc).
3. Re-parses the injected system prompt from a temp file.
4. Loads the `artifact-guard.ts` extension from disk.
5. Re-establishes the working directory and env.

For a provider like Claude or OpenAI this can add **2-10 s** of pure overhead *per stage* before the first token is even requested.

### Evidence
```ts
// lib/runner.ts
const exitCode = await new Promise<number>((resolve, reject) => {
  const proc = spawn(invocation.command, invocation.args, { ... });
  // ...
});
```

### Remediation
- **A. Reuse a single long-running Pi session** (if the Pi API exposes a session-based call) and feed prompts sequentially rather than respawning.
- **B. Batch sequential stages** where the output of one does not need human review before the next begins. For example, `evaluate` + `learning` could be a single prompt with two output sections, cutting invocations from 2 → 1 per loop.
- **C. Add an `--experimental-fast-restart` flag** (or env var) that skips extension re-validation and model warm-up when the caller knows the config is identical.
- **D. Cache the resolved `GUARD_EXTENSION_PATH`** and the parsed system prompt in memory; currently they are resolved/written fresh for every stage.

---

## 2. Synchronous Manifest I/O on the Hot Path (HIGH)

### Problem
`saveManifest()` is `await`-called inside `runManagedStage()` **twice per stage** (start + end) and also at bootstrap, after every loop, and on error paths. A 3-loop run triggers **~15–20** full JSON rewrites of the manifest.

### Evidence
```ts
// lib/workflow.ts — inside runManagedStage()
markStageRunning(record);
await saveManifest(manifestPath, manifest);   // ← write #1
// ... stage runs ...
markStageSuccess(record, result);
await saveManifest(manifestPath, manifest);   // ← write #2
```

### Remediation
- **Batch manifest writes.** Maintain a dirty flag; flush to disk only:
  - Every N seconds (e.g., 5 s heartbeat).
  - On stage completion (still acceptable).
  - On `SIGTERM` / `process.on('exit')` for crash recovery.
- **Use `fs.writeFile` with a memory buffer** for the running process and only serialize the delta, not the full object, or use a streaming JSON logger (append-only `.ndjson`) instead of a monolithic rewrite.

---

## 3. C7 Snapshot Walks the Entire Project Tree (HIGH)

### Problem
`takeSnapshot(cwd)` is called **before and after** every `develop` stage. It recursively reads *every* `.ts` file in the project root, computes SHA-256 hashes, and builds a full in-memory map. On a large codebase this is **O(files)** and blocks the event loop during file reads.

### Evidence
```ts
// lib/workflow.ts — inside the loop
const snapshotBefore = await takeSnapshot(cwd);
// ... develop stage (could take minutes) ...
const snapshotAfter  = await takeSnapshot(cwd);
```

### Remediation
- **A. Scope the snapshot to the expected mutation zone.** If the workflow is refining *extension source*, snapshot only `lib/` and `tests/`, not `node_modules/` (already excluded) or unrelated directories.
- **B. Use `fs.watch` / `watchFile` incremental tracking** instead of a full re-walk. Record changes as they happen.
- **C. Debounce / skip snapshots on early loops.** If the user runs 10 loops, the first 2 can skip C7; only enable it after loop 3 when material changes are more likely.
- **D. Replace SHA-256 with a faster hash** (e.g., `xxhash` via a native addon, or a simple `mtime + size` check) since cryptographic integrity is not required here.

---

## 4. Bloated & Redundant Prompts (HIGH)

### Problem
Every stage prompt repeats the same file-reading instructions and path resolution. The prompts for `buildReportUserPrompt` and `buildChecklistUserPrompt` list **all 9 artifacts** explicitly. This increases token count, cost, and latency (larger context windows = slower generation).

### Evidence
```ts
// lib/prompts.ts
export function buildReportUserPrompt(...) {
  return [
    "Read ALL produced artifacts before responding:",
    `- ${toProjectRelativePath(cwd, workspace.rootFiles.idea)}`,
    // ... repeated for 9 files ...
  ].join("\n");
}
```

### Remediation
- **A. Pre-compute a single `ARTIFACT_INDEX` block** and inject it into every prompt rather than rebuilding the list each time.
- **B. Use a compressed prompt template** (one-shot, with placeholders) loaded once at workflow start.
- **C. Elide unchanged artifacts.** After loop 1, only `RESPONSE.md`, `FEEDBACK.md`, `LEARNING.md`, and `BACKLOG.md` change. Tell the agent to re-read only the delta, not the full corpus.
- **D. Shrink system prompts.** They are excellent but verbose. Move the "mandatory output contract" into a shared preamble so it is not duplicated in every stage's system prompt.

---

## 5. Double Validation Tax (MEDIUM)

### Problem
`response-validator.ts` and `validator-check.ts` contain **near-identical** regex-based checks. `validator-check.ts` is called asynchronously after the workflow completes, but `response-validator.ts` is (ostensibly) available for runtime use yet never invoked inside the hot path. Maintaining two divergent copies increases bundle size and cognitive load.

### Evidence
- Both files compute `c1` (line count), `c2` (sections), `c3` (alternatives matrix), `c4` (epistemic tags), `c5` (decision terms), `c8` (before/after metrics).
- `validator-check.ts` has 85 max points; `response-validator.ts` has 100.

### Remediation
- **Merge into a single `validateResponse()` export** with a `strictness: 'fast' | 'full'` option.
- **Run validation inside the loop** (fast mode) to fail fast on pseudo-execution, rather than only post-hoc.
- **Cache validation results** per file path + mtime so re-validation is a no-op.

---

## 6. Over-Engineered Random Number Generator (MEDIUM)

### Problem
`generateRandomNumber()` instantiates a full **Mersenne Twister** (624-element `Uint32Array`, 624 loop iterations for seeding) and calls `crypto.getRandomValues()` just to produce a number between 1 and 100. This happens **once per loop** plus bootstrap.

### Evidence
```ts
// lib/number-generator.ts
class MersenneTwister { ... 624-element state ... }
export function generateRandomNumber(): number {
  const seed = Date.now();
  const mt = new MersenneTwister(seed);
  const mtValue = mt.extractNumber();
  // ... crypto.getRandomValues ...
}
```

### Remediation
- Replace with a single call to `crypto.getRandomValues(new Uint8Array(1))[0] % 100 + 1` or `Math.floor(Math.random() * 100) + 1`.  
  The Mersenne Twister’s cryptographic properties are unnecessary here; `crypto.getRandomValues` alone is sufficient.

---

## 7. Inefficient UI Render Loop (MEDIUM)

### Problem
- `scheduleRender()` uses a **150 ms debounce** for *all* updates, but critical events (`stage_started`, `stage_completed`) force `immediate = true`, causing rapid-fire synchronous re-renders during stage transitions.
- `Spinner` ticks every **80 ms** (12.5 fps) and calls `setWorkingMessage` on every frame, even when the message text is unchanged.
- `buildIdeaRefinementWidgetLines()` allocates a **new array and ~15 new strings** on every render.

### Evidence
```ts
// index.ts
const scheduleRender = (immediate = false) => { ... };
// lib/spinner.ts
this.timer = setInterval(() => this.tick(), this.intervalMs); // 80ms
// lib/ui-monitor.ts
export function buildIdeaRefinementWidgetLines(...) { /* creates new array every call */ }
```

### Remediation
- **Throttle, don’t debounce, the widget.** Render at most once per second unless a lifecycle event (start/end/fail) occurs.
- **Only call `setWorkingMessage` when text actually changes** (already partially guarded by `lastWorkingMessage`, but the spinner `onFrame` callback still fires 12×/s).
- **Reduce spinner interval to 160–200 ms** (5–6 fps) — the eye cannot perceive faster in a terminal UI.
- **Memoize `buildIdeaRefinementWidgetLines`** against a shallow-equality check of `monitorState`.

---

## 8. Synchronous File Reads in `artifact-guard.ts` (MEDIUM)

### Problem
The guard hooks **every `tool_call` event** and performs synchronous `existsSync` + `readFileSync` + `JSON.parse` to check if a protected root is in terminal state. In a busy agent loop with dozens of tool calls, this blocks the event loop.

### Evidence
```ts
// artifact-guard.ts
function isRootInTerminalState(root: string): boolean {
  const manifestPath = path.join(root, "run.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    // ...
  }
}
```

### Remediation
- **Cache terminal-state status in memory** (a `Set<string>` of completed roots) and invalidate it only when `saveManifest` updates a root to `success`/`failed`.
- If caching is impossible, use `fsp.access` + `fsp.readFile` (async) so the guard does not block the main thread.

---

## 9. Redundant `normalizeMarkdown` Calls (LOW)

### Problem
`writeMarkdownFile()` calls `normalizeMarkdown()` which runs `content.replace(/\r\n/g, "\n").trim()` on every write. During a loop, the same content may be written to the root file *and* the loop snapshot file, doubling the work.

### Remediation
- Memoize normalization by content hash, or simply call `normalizeMarkdown` once before the dual-write.

---

## 10. Unnecessary `path.relative` / String Allocations (LOW)

### Problem
`toProjectRelativePath()` is called **dozens of times** per workflow to build prompts and manifest paths. It allocates a new string via `path.relative` + `split(path.sep).join("/")` every time.

### Evidence
```ts
// lib/prompts.ts — every build*UserPrompt call
`- ${toProjectRelativePath(cwd, workspace.rootFiles.idea)}`,
```

### Remediation
- Pre-compute all relative paths **once** when `CallWorkspace` is created and store them on the workspace object. Prompt builders should read from the cache.

---

## 11. No Parallelization of Independent Stages (MEDIUM-HIGH — architectural)

### Problem
`evaluate` does not depend on `learning` from the *same* loop, yet they run serially. `report` and `checklist` at the end are also independent. The current design guarantees sequential correctness but leaves CPU/network idle.

### Evidence
```ts
// lib/workflow.ts — sequential by design
const evaluateResult = await runManagedStage({ stageName: "evaluate", ... });
// ... then ...
const learningResult = await runManagedStage({ stageName: "learning", ... });
```

### Remediation
- **Parallelize `report` + `checklist`** (final consolidation stages) with `Promise.all`.
- For `evaluate` + `learning`, evaluate cannot start until `develop` finishes, but `learning` *could* theoretically be merged into `evaluate` as a dual-output prompt (see §1-B). If the model supports multi-part responses, this halves the invocation count.

---

## 12. JSONL Log Filtering in JavaScript (LOW)

### Problem
`shouldPersistStdoutLogLine()` scans every stdout line with multiple `String.prototype.includes()` calls to decide whether to write it to the log file. With verbose agent output, this is `O(lines × patterns)`.

### Evidence
```ts
function shouldPersistStdoutLogLine(line: string): boolean {
  if (line.includes('"type":"message_update"')) return false;
  return (
    line.includes('"type":"session"') ||
    line.includes('"type":"agent_start"') ||
    // ... 6 more includes ...
  );
}
```

### Remediation
- Compile a single `RegExp` at module init:
  ```ts
  const KEEP_RE = /"type":"(?:session|agent_start|turn_start|turn_end|message_start|message_end|tool_execution_start|tool_execution_end)"/;
  ```
- Or, since `pi --mode json` already emits structured lines, instruct Pi to output only the desired event types natively (if supported by the CLI) rather than filtering post-hoc.

---

## 13. No Timeout on `takeSnapshot` / `fs.readdir` (LOW)

### Problem
`takeSnapshot` uses unbounded recursion over `fs.readdir`. A deep or symlink-loop directory structure could hang the workflow indefinitely.

### Remediation
- Add a `maxDepth` parameter (e.g., 6) and a `maxFiles` cap (e.g., 5 000). Abort with a warning rather than hanging.

---

## 14. Memory Retention of `stderrTail` (LOW)

### Problem
`stderrTail` is bounded to 32 768 chars, but `appendTail()` still allocates intermediate strings on every stderr chunk.

### Remediation
- Use a `Buffer` or circular-buffer approach instead of string concatenation and slicing.

---

## Prioritized Action Matrix

| Priority | Issue | Effort | Expected Speed-Up |
|----------|-------|--------|-------------------|
| P0 | **Subprocess reuse / batching** (§1) | High | **40-60 %** total runtime |
| P1 | **Manifest write batching** (§2) | Low | 5-10 % |
| P1 | **C7 snapshot optimization** (§3) | Medium | 5-15 % per loop |
| P1 | **Prompt deduplication & elision** (§4) | Medium | 10-20 % token latency |
| P2 | **Merge validators** (§5) | Low | Maintainability + slight CPU |
| P2 | **Simplify RNG** (§6) | Trivial | Micro-optimization |
| P2 | **UI render throttling** (§7) | Low | Reduces UI jank |
| P2 | **Async artifact-guard** (§8) | Low | Removes event-loop blocks |
| P3 | **Parallelize report + checklist** (§11) | Low | ~5-10 % end-of-workflow |
| P3 | **Pre-compute relative paths** (§10) | Trivial | Micro-optimization |
| P3 | **Regex-based log filtering** (§12) | Trivial | Micro-optimization |

---

## Quick Wins (implement today)

1. **Replace Mersenne Twister** with `crypto.getRandomValues` (§6).
2. **Throttle spinner** to 160 ms and widget render to 1 s (§7).
3. **Pre-compute relative paths** on `CallWorkspace` (§10).
4. **Batch manifest writes** with a 2-second debounce flush (§2).
5. **Compile `KEEP_RE`** regex for log filtering (§12).
6. **Parallelize** `report` and `checklist` stages with `Promise.all` (§11).

---

## Architectural Bets (biggest payoff)

1. **Single-session Pi runner:** Instead of `spawn()` per stage, keep one Pi child process alive and pipe prompts to it over stdin or a local socket. This eliminates cold-start overhead entirely but requires negotiation with the Pi CLI maintainers or a custom API client.
2. **Delta-prompting:** After loop 1, only send changed artifacts to the model. This dramatically shrinks context windows and token cost, especially for long `RESPONSE.md` files.
3. **Streaming manifest:** Replace the monolithic `run.json` with an append-only `run.ndjson` log. Writes become O(1) appends rather than O(n) full-serialization rewrites.

---

*End of report.*
