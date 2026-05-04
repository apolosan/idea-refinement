# METRICS

## M1: Total Workflow Wall-Clock Time
- **Definition:** Elapsed time from bootstrap stage start to checklist stage completion, measured in seconds. [DECISION]
- **Scale/Formula:** `checklistEnd - bootstrapStart` using `performance.now()` or `Date.now()`. [DECISION]
- **Collection:** Instrument `runManagedStage` in `lib/workflow.ts` to record start and end timestamps per run. [DECISION]
- **Frequency:** Every run. [DECISION]
- **Baseline:** Current 3-loop run incurs ~12 subprocess invocations with 2-10 s cold-start each; total overhead is dominant. [FACT: file: IDEA.md, section: Subprocess Cold-Start Tax]
- **Success Threshold:** ≥ 20% reduction on the same fixture and provider. [DECISION]
- **False-Positive Risk:** Network latency or model provider slowdown can inflate times independent of code changes; mitigate by running 3 trials and discarding outliers. [RISK]

## M2: Manifest Write Count
- **Definition:** Number of times `saveManifest` is invoked during a single workflow run. [DECISION]
- **Scale/Formula:** Integer count, incremented at the call site. [DECISION]
- **Collection:** Add a counter inside `saveManifest` or `runManagedStage` in `lib/workflow.ts`, logged at process exit. [DECISION]
- **Frequency:** Every run. [DECISION]
- **Baseline:** ~15-20 writes per 3-loop run. [FACT: file: IDEA.md, section: Synchronous Manifest I/O]
- **Success Threshold:** ≤ 6 writes per 3-loop run (start, end, and one per loop for crash recovery). [DECISION]
- **False-Positive Risk:** Error paths may trigger extra writes; mitigate by measuring only successful runs. [RISK]

## M3: Prompt Character Count (Post-Loop-1)
- **Definition:** Total character length of the user prompt string passed to the model for stages after loop 1. [DECISION]
- **Scale/Formula:** `userPrompt.length` before submission. [DECISION]
- **Collection:** Instrument prompt builders in `lib/prompts.ts` to record length per stage. [DECISION]
- **Frequency:** Every stage from loop 2 onward. [DECISION]
- **Baseline:** Prompts currently list 9 artifacts explicitly via `toProjectRelativePath`. [FACT: file: lib/prompts.ts, excerpt: 9 artifact path interpolations]
- **Success Threshold:** ≤ 60% of loop 1 prompt length when delta-prompting is active. [DECISION]
- **False-Positive Risk:** Character count is a proxy for token count; actual tokens depend on model-specific tokenization. Mitigate by comparing ratios on the same model. [RISK]

## M4: Snapshot File Scan Count
- **Definition:** Number of files visited by `takeSnapshot` during a single invocation. [DECISION]
- **Scale/Formula:** Integer count of files hashed and mapped. [DECISION]
- **Collection:** Increment a counter inside `takeSnapshot` in `lib/snapshot.ts`. [DECISION]
- **Frequency:** Every `develop` stage (before and after). [DECISION]
- **Baseline:** Full project tree minus `node_modules`. [FACT: file: IDEA.md, section: C7 Snapshot Walks]
- **Success Threshold:** ≤ 50% of baseline when scoped to `lib/` + `tests/` on a representative codebase. [DECISION]
- **False-Positive Risk:** If mutations occur outside the scoped directory, the snapshot will miss them; mitigate by allowing override via workspace config. [RISK]

## M5: Artifact-Guard Blocking Time
- **Definition:** Cumulative milliseconds spent inside `isRootInTerminalState` per workflow run. [DECISION]
- **Scale/Formula:** Sum of `performance.now()` deltas around the function body. [DECISION]
- **Collection:** Instrument `artifact-guard.ts` or wrap `isRootInTerminalState`. [DECISION]
- **Frequency:** Every `tool_call` event. [DECISION]
- **Baseline:** Synchronous `existsSync` + `readFileSync` + `JSON.parse` on every tool call. [FACT: file: artifact-guard.ts, excerpt: sync file operations]
- **Success Threshold:** Mean time per call < 1 ms via in-memory cache. [DECISION]
- **False-Positive Risk:** File system cache may mask blocking on repeated paths; mitigate by testing on a cold start. [RISK]
