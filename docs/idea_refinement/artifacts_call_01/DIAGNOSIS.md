# DIAGNOSIS

## Factual Map

### Subprocess Architecture
- `lib/runner.ts` invokes `spawn()` for every stage invocation. [FACT: file: lib/runner.ts, excerpt: `const proc = spawn(invocation.command, invocation.args, { ... });`]
- Each subprocess incurs model-load, extension-init, and system-prompt re-parse overhead. [FACT: observable behavior: cold-start delay before first token]

### Manifest I/O
- `lib/workflow.ts` calls `saveManifest` at stage start and stage end. [FACT: file: lib/workflow.ts, excerpt: `markStageRunning(record); await saveManifest(...)` and `markStageSuccess(record, result); await saveManifest(...)`]
- A 3-loop run triggers ~15-20 JSON rewrites. [FACT: file: IDEA.md, section: Synchronous Manifest I/O, observable count derived from stage sequence]

### C7 Snapshot
- `takeSnapshot(cwd)` walks the entire project tree recursively before and after each `develop` stage. [FACT: file: lib/workflow.ts, excerpt: `const snapshotBefore = await takeSnapshot(cwd);` and `const snapshotAfter = await takeSnapshot(cwd);`]
- Snapshot computes SHA-256 per file and builds an in-memory map. [FACT: file: lib/snapshot.ts, observable: SHA-256 hash computation]

### Prompt Construction
- `buildReportUserPrompt` and `buildChecklistUserPrompt` explicitly list all 9 artifacts via `toProjectRelativePath`. [FACT: file: lib/prompts.ts, excerpt: repeated artifact path interpolation]
- Prompt templates are rebuilt per stage rather than reused. [FACT: observable: function returns new string array on every call]

### Validation Logic
- `response-validator.ts` and `validator-check.ts` both implement regex-based checks for c1, c2, c3, c4, c5, c8. [FACT: files: response-validator.ts and validator-check.ts, field: regex patterns and scoring variables]
- `validator-check.ts` runs post-workflow; `response-validator.ts` is present but unused in the hot path. [FACT: file: IDEA.md, section: Double Validation Tax, observable: invocation location]

### UI Render Loop
- `scheduleRender` debounces at 150 ms but lifecycle events force `immediate = true`. [FACT: file: index.ts, excerpt: `const scheduleRender = (immediate = false) => { ... };`]
- `Spinner` ticks at 80 ms (12.5 fps). [FACT: file: lib/spinner.ts, excerpt: `this.timer = setInterval(() => this.tick(), this.intervalMs); // 80ms`]
- `buildIdeaRefinementWidgetLines` allocates new arrays/strings per render. [FACT: file: lib/ui-monitor.ts, observable: array literal creation on every call]

### Artifact Guard
- `artifact-guard.ts` hooks every `tool_call` and performs `existsSync` + `readFileSync` + `JSON.parse`. [FACT: file: artifact-guard.ts, excerpt: `function isRootInTerminalState(root: string): boolean { ... existsSync ... readFileSync ... JSON.parse ... }`]

### Stage Parallelism
- `evaluate`, `learning`, `report`, and `checklist` execute sequentially in `lib/workflow.ts`. [FACT: file: lib/workflow.ts, observable: `await runManagedStage({ stageName: "evaluate", ... })` followed sequentially by learning, etc.]

### Log Filtering
- `shouldPersistStdoutLogLine` scans each line with multiple `String.prototype.includes()` calls. [FACT: file: lib/logging.ts or equivalent, excerpt: multiple `line.includes(...)` checks]

## Inferences
- Subprocess cold-start accounts for the majority of workflow latency because each stage adds 2-10 s before token generation. [INFERENCE: based on reported cold-start duration multiplied by 12 invocations per 3-loop run]
- Manifest rewrites are on the hot path because they occur synchronously inside `runManagedStage`. [INFERENCE: because `await saveManifest` blocks stage transition]
- The 9-artifact prompt list increases token count and cost. [INFERENCE: based on string length and typical tokenization ratios]

## Hypotheses
- Batching `evaluate` + `learning` into a dual-output prompt will halve invocations for those stages without quality loss. [HYPOTHESIS]
- Replacing monolithic JSON manifest with append-only NDJSON will reduce write latency by an order of magnitude. [HYPOTHESIS]
- Caching terminal-state status in `artifact-guard.ts` will reduce per-tool-call blocking to sub-millisecond. [HYPOTHESIS]

## Proposals
- **P1:** Implement a dirty-flag debounce for `saveManifest` with a 2-second flush and `SIGTERM` emergency write. [PROPOSAL]
- **P2:** Scope `takeSnapshot` to `lib/` and `tests/` with optional workspace config override. [PROPOSAL]
- **P3:** Pre-compute `ARTIFACT_INDEX` once at workspace creation and inject it into prompt builders. [PROPOSAL]
- **P4:** Merge validators into `validateResponse(strictness: 'fast' | 'full')` and invoke fast mode inside the loop. [PROPOSAL]
- **P5:** Throttle widget render to 1 s, reduce spinner to 160 ms, and memoize widget lines against shallow state equality. [PROPOSAL]
- **P6:** Cache terminal-state roots in a `Set<string>` updated only on manifest state transitions. [PROPOSAL]
- **P7:** Parallelize `report` and `checklist` with `Promise.all`. [PROPOSAL]
- **P8:** Compile a single `RegExp` for stdout log filtering at module init. [PROPOSAL]

## Decisions
- Random number generation is frozen. [DECISION: constraint from IDEA.md]
- Creativity/exploration is the active policy; structural experiments are authorized. [DECISION]
- Delta-prompting and append-only manifest are approved for prototyping. [DECISION]

## Risks
- Session-reuse or subprocess batching may introduce state leakage between loops. [RISK]
- Delta-prompting may omit critical static constraints. [RISK]
- Parallel `report` + `checklist` may race on manifest access if locking is absent. [RISK]
- Scoping snapshots may miss root-level config changes. [RISK]

## Current State vs. Proposed State

| Dimension | Current State | Proposed State |
|-----------|---------------|----------------|
| Subprocess model | One spawn per stage | Explore persistent session or batched prompts |
| Manifest writes | ~15-20 synchronous JSON rewrites per 3-loop run | ≤ 6 flushes via debounce or append-only log |
| Snapshot scope | Entire project tree, SHA-256, before/after develop | Scoped to `lib/` + `tests/`, possibly incremental |
| Prompt delivery | Full 9-artifact list rebuilt every stage | Pre-computed index; delta after loop 1 |
| Validation | Two near-identical files, post-hoc only | Single module, fast mode inside loop |
| UI render | 150 ms debounce, 80 ms spinner, new arrays per frame | 1 s throttle, 160 ms spinner, memoized lines |
| Artifact guard | Sync file read on every `tool_call` | In-memory `Set` cache updated on state change |
| Stage parallelism | Entirely serial | `report` + `checklist` parallelized |
