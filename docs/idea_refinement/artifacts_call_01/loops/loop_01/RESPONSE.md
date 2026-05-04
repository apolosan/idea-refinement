# Response

## Loop framing
Loop **1/10**, contextual seed **72**, active policy **CREATIVITY/EXPLORATION**. [FACT: file: DIRECTIVE.md, section: Selected Policy]  
This loop is scoped to **I/O hot-path optimization** and **subprocess architecture exploration**, leaving prompt-delivery and validation consolidation for loop 2 when baseline token counts are available. [DECISION]

## Focused loop diagnosis
The workflow spawns **~12 pi subprocesses** per 3-loop run, each incurring 2–10 s cold-start tax. [FACT: file: IDEA.md, section: Subprocess Cold-Start Tax]  
On the I/O hot path, `saveManifest` is invoked **~15–20× per run** with full JSON re-serialization; `takeSnapshot` walks the entire project tree (unbounded depth, no file cap) before and after every `develop` stage; the log filter scans each stdout line with **8 sequential `includes()`** checks; and the UI forces re-renders at 80 ms spinner intervals. [FACT: file: IDEA.md, sections 2, 3, 7, 12; file: lib/workflow.ts, excerpt: `await saveManifest` at stage start/end; file: lib/runner.ts, excerpt: `shouldPersistStdoutLogLine` with 8 `includes`; file: index.ts, excerpt: `intervalMs: 80`]  
No baseline measurements exist for M2 (manifest writes), M3 (prompt size), or M4 (snapshot scan count). [FACT: file: METRICS.md, observable: no instrumentation in `saveManifest`, `build*UserPrompt`, or `takeSnapshot` prior to this loop]

## Operational questions and applied external research
1. **Does the Pi CLI support a persistent stdin/socket session?** [DOUBT]  
   *Research:* Inspected `lib/runner.ts` and found `spawn()` with `--no-session` flag hard-coded in `buildPiArgs`. [FACT: file: lib/runner.ts, excerpt: `"--no-session"`] No native Pi session-reuse API is exposed in the extension surface. [INFERENCE]  
2. **What is the actual file scan volume of `takeSnapshot(cwd)` on this repo?** [DOUBT]  
   *Research:* `wc -l` on `lib/*.ts` shows ~1,300 LOC; the full project tree (excluding `node_modules`) contains 24 `.ts` files. [FACT: bash `find . -name '*.ts' -not -path './node_modules/*'`] Scoping to `lib/` + `tests/` reduces scan volume to **18 files** (–25%), but on larger workspaces the reduction is expected to exceed 50%. [INFERENCE]

## Minimum alternatives matrix

### Lens A — I/O Hot-Path Optimization

| Alternative | Problem | Mechanism | Benefit | Cost | Risk | Evidence/Status |
|-------------|---------|-----------|---------|------|------|-----------------|
| **A1. Scoped snapshot with bounds** | Unbounded recursive SHA-256 scan of entire project tree before/after develop. [FACT: file: lib/post-hoc-check.ts, observable: `walkDir` without depth/file caps] | Add `TakeSnapshotOptions` (`scope`, `maxDepth: 6`, `maxFiles: 5000`) and restrict scans to `["lib", "tests"]`. | Cuts scan volume; prevents symlink-loop hangs. | ~20 LOC added; no deps. | May miss root-level config mutations. [RISK] | **IMPLEMENTED** [EXECUTED] in `lib/post-hoc-check.ts` and `lib/workflow.ts`. |
| **A2. Manifest write debounce** | ~15–20 synchronous full-JSON rewrites per run. [FACT: file: IDEA.md, section 2] | Dirty-flag flush on timer + `SIGTERM`; await explicit flush at stage boundaries. | O(n) serialization → O(1) batched writes. | Refactors `saveManifest` contract; requires flush coordination. | Crash between flushes loses up to 2 s of state. [RISK] | **INSTRUMENTED** [EXECUTED] — added `manifestWriteCount` in `lib/manifest.ts` to establish M2 baseline before behavior change. |
| **A3. Compiled regex log filter** | O(lines × patterns) CPU on verbose JSONL stdout. [FACT: file: lib/runner.ts, observable: 8 `includes` checks] | Single `RegExp` compiled at module init. | Reduces per-line filtering to O(line length). | Trivial (2 LOC). | Regex harder to maintain than explicit `includes`. [RISK] | **IMPLEMENTED** [EXECUTED] in `lib/runner.ts`; `tsc --noEmit` passes. |
| **A4. Throttled widget render + slower spinner** | 80 ms spinner (12.5 fps) and 150 ms debounce allocate arrays/strings every frame. [FACT: file: index.ts, excerpt: `intervalMs: 80`; file: lib/ui-monitor.ts, observable: array literal per call] | Reduce spinner to 160 ms (6 fps); throttle non-lifecycle widget renders to 1 s. | Removes imperceptible render work and GC pressure. | ~8 LOC. | May feel sluggish on high-refresh terminals. [RISK] | **IMPLEMENTED** [EXECUTED] in `index.ts`. |

### Lens B — Subprocess Cold-Start Architecture

| Alternative | Problem | Mechanism | Benefit | Cost | Risk | Evidence/Status |
|-------------|---------|-----------|---------|------|------|-----------------|
| **B1. Persistent Pi session** | Each stage spawns a new `pi` child with `--no-session`. [FACT: file: lib/runner.ts, excerpt: `spawn(...)` and `"--no-session"`] | Long-running subprocess accepting multiple prompts over stdin or local socket. | Eliminates cold-start overhead entirely (40–60 % total runtime). | Requires Pi CLI API negotiation or custom client; high uncertainty. | State leakage between loops; memory accumulation. [RISK] | **DEFERRED** — needs external confirmation of Pi session API. |
| **B2. Batched evaluate+learning prompt** | `evaluate` and `learning` are separate spawns despite no intra-loop dependency. [FACT: file: lib/workflow.ts, observable: sequential `runManagedStage` calls] | Single prompt with two output sections (evaluation + learning update). | Halves invocations for those stages (–2 per 3-loop run). | Requires new prompt template and parser. | Model may conflate criteria with synthesis, degrading FEEDBACK.md quality. [RISK] | **DEFERRED** — prototype after M3 baseline exists to measure token impact. |
| **B3. Delta-prompting after loop 1** | Full 9-artifact list rebuilt every stage, inflating context window. [FACT: file: lib/prompts.ts, excerpt: repeated `toProjectRelativePath` for 9 files] | Inject pre-computed `ARTIFACT_INDEX` once; after loop 1, send only changed artifacts + index reference. | 40–60 % token reduction post-loop-1. | Requires tracking artifact mtimes; may cause constraint drift. [RISK] | Model may ignore static constraints in elided artifacts. [RISK] | **DEFERRED** — depends on M3 baseline measurement. |

## Current state vs. proposed state

| Dimension | Current State (pre-loop-1) | Proposed State (post-loop-1) |
|-----------|---------------------------|------------------------------|
| Log filter | 8 `includes()` checks per line | Single compiled `RegExp` [EXECUTED] |
| Snapshot | Full project tree, unbounded depth/files | Scoped to `lib/` + `tests/`, `maxDepth: 6`, `maxFiles: 5000` [EXECUTED] |
| Manifest writes | ~15–20 full JSON rewrites per run | Instrumented counter ready for debounce prototype [EXECUTED] |
| UI render | 150 ms debounce, 80 ms spinner, new arrays/frame | 1 s throttle, 160 ms spinner, lifecycle-immediate [EXECUTED] |
| Subprocess model | One spawn per stage | Persistent session hypothesis archived for loop 2 |
| Prompt delivery | Full 9-artifact rebuild every stage | Delta-prompting hypothesis archived for loop 2 |

## Experiment protocol
1. **Baseline collection:** Run `tsc --noEmit` (passes). [FACT: verified by bash] Run a 3-loop workflow on a fixture project and read `manifestWriteCount` to establish M2 baseline.  
2. **Scoped snapshot validation:** Verify `takeSnapshot` warns on truncation (`depthExceeded`/`filesExceeded`) by temporarily lowering `maxFiles` to 5 in a test.  
3. **UI throttling validation:** Confirm `scheduleRender` non-immediate calls are spaced ≥ 1 s apart by adding `console.time` instrumentation during a local dry-run.  
4. **Regression guard:** Ensure C7 snapshot diff still detects `.ts` changes in `lib/` after scoping. [DECISION]  
5. **Rollback:** Revert `lib/workflow.ts` to `takeSnapshot(cwd)` if any legitimate mutation outside `lib/`/`tests/` is missed. [DECISION]

## Iteration decision
**Adopt A1, A2-instrumentation, A3, and A4 immediately** because they are low-cost, compile-verified, and reduce hot-path drag without altering the output contract. [DECISION]  
**Defer B1, B2, and B3 to loop 2** because they require external API confirmation (B1), prototype quality validation (B2), or token-count baselines (B3) that are not yet available. [DECISION]  
**Do not touch random number generation** per immutable rule. [DECISION: file: DIRECTIVE.md, immutable rule 1]

## Explicit discards of this iteration
- **Mersenne Twister replacement:** Explicitly excluded by request. [DISCARD: file: IDEA.md, opening paragraph]  
- **SHA-256 → xxhash:** Requires native addon; dependency cost exceeds marginal gain when snapshot scoping is available. [DISCARD: file: LEARNING.md, section: Relevant Discards]  
- **Parallelize report + checklist with `Promise.all`:** Discarded for loop 1 because concurrent `runManagedStage` calls would race on `saveManifest` writes; safe only after manifest debounce or append-only logging is proven. [DISCARD: file: BACKLOG.md, Item 8, risk: manifest corruption]  
- **Validator consolidation:** Discarded for loop 1 because merging `response-validator.ts` and `validator-check.ts` risks dropping a rule without a regression test battery, which must be built first. [DISCARD: file: BACKLOG.md, Item 5, risk: lost validation rule]

## Next focuses
1. **Collect M2 baseline** using the newly instrumented `manifestWriteCount` to decide whether debounce (A2-full) justifies the flush-complexity cost. [FOCUS]  
2. **Research Pi CLI session API** to falsify or validate the persistent-session hypothesis (B1). [FOCUS]  
3. **Prototype delta-prompting** on loop 2 by measuring `buildDevelopmentUserPrompt` character count before and after elision. [FOCUS]  
4. **Scope subprocess batching** (B2) if cold-start remains the dominant bottleneck after I/O wins are measured. [FOCUS]
