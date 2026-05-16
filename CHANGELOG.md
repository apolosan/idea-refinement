# Changelog

## 1.11.0 - 2026-05-15

### Fixed
- `runManagedStage()` now detects provider errors caused by unsupported `reasoning` field in messages and automatically retries without the thinking level, preventing workflow failures with providers like `opencode-go` that reject extended thinking fields.
- `runFinalStages()` now retries report and checklist generation up to 3 times when required headings are missing. On each retry, the prompt is reinforced with explicit list of missing headings to guide the LLM toward compliant output.

## 1.10.0 - 2026-05-15
### Added
- Realpath-aware path guard helpers in `lib/path-guards.ts`, with regression coverage for symlink escapes.
- `lib/workflow-limits.ts` centralizes loop-count policy and enforces the hard limit in the workflow API.
- `lib/final-artifact-validator.ts` validates required `REPORT.md` and `CHECKLIST.md` headings before final artifacts are accepted.
- CI now includes `npm audit --audit-level=high`, and `release:check` includes the same audit plus JSON package dry-run output.

### Changed
- `artifact-guard.ts` now blocks project-local symlinks that resolve outside the project or protected workspace.
- Resume sources must resolve to an `artifacts_call_NN` directory inside `docs/idea_refinement` for the active project.
- Stage success is now recorded after stage output persistence, reducing the chance of a successful stage with missing artifacts.
- Marker parsing now uses strict complete-marker extraction by default and exposes explicit recovery mode for diagnostics.
- `validator-check` now escapes Markdown table cells, uses relative paths when possible, and relies on validator `passed` status.
- `post-hoc-check` hashes files by stream and rejects snapshot scopes that resolve outside the extension root.
- Public documentation and versioned source text are standardized on American English.
- `.gitignore` and `.npmignore` now ignore generated `docs/idea_refinement` artifacts without hiding ADR documentation.

### Fixed
- Startup locking now begins before interactive prompt collection to reduce duplicate workflow starts.
- The workflow monitor receives a completion event for the synthetic `learning` stage in the combined evaluate+learning flow.
- `findNextCallNumber()` now treats only `ENOENT` as an empty call-root condition and propagates other filesystem errors.
- The transitive `fast-xml-builder` vulnerability is resolved through a package override to a safe version.

### Removed
- Duplicate GitHub Actions workflow configuration in `.github/workflows/test.yml`.
- Dead JSON-string extraction helper from `lib/runner.ts`.

## 1.9.2 - 2026-05-15

### Added
- `docs/adr/0001-response-validator-role.md`: explicit decision that `validator-check` is **offline QA with visibility**, not a workflow gate.
- `lib/platform-support.ts` and a `/idea-refine` warning for platforms where `SIGSTOP`/`SIGCONT` are unavailable, such as Windows.
- Optional validator-result recording in `run.json` (`auxiliaryFiles.responseValidatorOutput`, `lastValidatorCheckScore`) through `recordValidatorCheckOnManifest()`.
- Carry-forward metadata in `LoopManifestEntry`: `carriedForward`, `seededFromRun`, and `seededFromLoop`, in addition to `carriedForwardFrom`.

### Changed
- `artifact-guard.ts`: reads and `ls`/`tree` resolve paths relative to `cwd` and must stay **inside the project**; edits in `docs/idea_refinement/artifacts_call_01/**` are blocked; `ls`/`tree` validate the resolved target against `cwd`.
- Command loop limits: confirmation above **20** loops and refusal above **1000**, aligned with documentation.
- `peerDependencies` for `@mariozechner/pi-coding-agent` now declare the tested range `>=0.72.0 <1.0.0`.
- `lib/validator-check.ts`: atomic output writes; it can update the manifest when it receives `manifestPath` + `cwd`.
- `.github/workflows/test.yml`: aligned with the main CI flow (`npm ci`, typecheck, tests, `npm pack --dry-run`).
- `README.md`: supported platforms, loop limits, and peer compatibility.

### Removed
- `shouldRunFinalStagesOnly` field in `ResumeSourceAnalysis`, which was calculated but not used by the flow.
- Unused `cwd` parameter in `buildPiArgs()` (`lib/runner.ts`).

### Fixed
- `analyzeFailedRunForResume()` wraps `readManifest()` errors with an explicit message, distinguishing invalid manifests from opaque crashes.
- `writeJsonFile()` documents that JSON must not pass through Markdown-oriented normalization, preserving structural whitespace.

## 1.9.0 - 2026-05-13

### Added
- Command-level loop-count guardrails in `index.ts`: explicit confirmation for unusually large runs, a hard upper limit, and runtime/cost estimates before execution starts.
- CI pipeline at `.github/workflows/ci.yml` running `npm ci`, `npm run typecheck`, `npm run test:ci`, and `npm pack --dry-run`.
- Entry-point coverage in `tests/lib/index.test.ts` for thinking-level propagation and loop-count guardrails.

### Changed
- `artifact-guard.ts` now restricts reads to the project scope, restricts `ls`/`tree` to relative paths inside the active call workspace, blocks historical edits outside the active run, and persists denial audit records.
- Resume manifests now separate carried-forward provenance from current-run execution metadata via explicit `carried_forward` stage states and provenance fields in `run.json`.
- Workspace allocation in `lib/path-utils.ts` now uses the next known call number as the default hint while keeping safe fallback scanning.
- Public docs now describe the exploration/exploitation mechanism as a virtual/simplified in-run strategy rather than local persistent reinforcement learning.

### Fixed
- Command-layer thinking-level propagation from the active Pi session into workflow subprocess invocations.
- Manifest governance gaps around resume context paths, loop backlog registration, raw-attempt tracking, and schema-versioned manifest reads.

## 1.8.7 - 2026-05-14

### Added
- Sixth extraction strategy in `lib/marker-parser.ts`: sequential `<<<BEGIN FILE:…>>>` spans inferred up to the next begin marker (or EOF), plus a fenced-Markdown retry path, so bootstrap/evaluate payloads still parse when models omit all `<<<END FILE:…>>>` closers (common with truncation or incomplete completions).
- Regression test for begin-only bootstrap bundles in `tests/lib/marker-parser.test.ts`.

### Changed
- `extractOverallScore()` in `lib/validation.ts` now tolerates markdown emphasis, light HTML, and simple table/equals variants when locating `Overall score: NN/100`.
- Evaluate prompts in `lib/prompts.ts` emphasize a plaintext `Overall score: NN/100` line requirement for machine parsing.
- `tests/lib/workflow.test.ts` bootstrap-loop harness emits a valid `message_end` immediately and tightens SIGTERM cleanup (timing budget relaxed slightly to reduce flake).

### Fixed
- Bootstrap failures reporting `0 end marker(s)` and `Missing marked section(s) for: DIRECTIVE.md, LEARNING.md, …` despite valid interleaved bodies after each `BEGIN` header.

## 1.8.5 - 2026-05-13

### Added
- `canonicalizeMarkerDelimiters()` in `lib/marker-parser.ts` to normalize common LLM marker variants (extra spaces around colons, casing drift on `BEGIN`/`END FILE`, and `<<<END OF FILE: …>>>`) into strict `<<<BEGIN FILE:…>>>` / `<<<END FILE:…>>>` before extraction and diagnostics.
- Regression tests for lowercase/spaced `END` markers and the `END OF FILE` closing synonym in `tests/lib/marker-parser.test.ts`.

### Fixed
- Misleading bootstrap diagnostics reporting `0 end marker(s)` while the model had actually emitted flexible closers (for example `<<< end file : DIRECTIVE.md >>>`), which did not match the strict `<<<END FILE:` substring used only for counting.

## 1.8.4 - 2026-05-12

### Added
- Fifth extraction strategy in `lib/marker-parser.ts`: basename-aware pairing for `<<<BEGIN FILE: …>>>` / `<<<END FILE: …>>>` labels, so artifacts still parse when models emit directory-prefixed paths (for example `docs/idea_refinement/artifacts_call_NN/FEEDBACK.md`) instead of bare `FEEDBACK.md`.
- Flexible whitespace inside marker tokens (for example `<<< BEGIN FILE : FEEDBACK.md >>>`) and a fenced-markdown retry path for the basename scanner.
- Regression tests for path-prefixed markers and spaced marker tokens in `tests/lib/marker-parser.test.ts`.
- Explicit **machine-parseable marker contract** in `lib/prompts.ts` for bootstrap and evaluate+learning stages: bare filenames only, no paths inside marker labels, no wrapping marker tokens in backticks/HTML.

### Changed
- Evaluate+learning stage prompts now spell out non-negotiable marker rules aimed at small or imprecise models while the parser remains tolerant of common mistakes.

### Fixed
- False `"Missing marked section(s) for: FEEDBACK.md, LEARNING.md, BACKLOG.md"` failures after loop 1 when the model used full artifact paths inside otherwise well-formed markers (diagnostic showed matching begin/end counts but zero extracted sections).

## 1.8.3 - 2026-05-05

### Added
- Explicit tool-call payload guidance in `lib/prompts.ts` for `read` and `bash`, including exact JSON shapes and a single retry-after-fix rule.
- `npm test` script in `package.json` for the project test suite.

### Changed
- Simplified and shortened the stage prompts in `lib/prompts.ts` to reduce model overhead during bootstrap, development, evaluation, report, and checklist generation.
- Rolled out `stdin` prompt transport across all workflow stages in `lib/workflow.ts` instead of limiting it to `CHECKLIST.md`.
- Updated `README.md` to document the leaner prompt set, full `stdin` transport, and the corrected exploration/exploitation wording.

### Fixed
- Reduced the prompt-induced first-attempt failure pattern where some models would emit malformed `read` or `bash` tool payloads and only recover on a second try.
- Reduced avoidable bootstrap latency tied to overly verbose stage instructions and heavier subprocess prompt transport.

## 1.8.2 - 2026-05-05

### Added
- Early-success stage capture in `lib/runner.ts`, allowing the parent extension to terminate a subprocess as soon as a structurally valid final artifact payload is already available.
- Explicit subprocess-loop protection in `lib/runner.ts` via a capped number of assistant `message_end` responses per stage, with a clear error instead of an indefinite bootstrap/evaluate stall.
- Regression coverage for both failure modes: valid bootstrap payload followed by endless subprocess looping, and explicit assistant-response loop exhaustion.

### Changed
- `runPiStage()` now filters `message_end` handling to assistant-role messages only and can stop early when a stage-specific validator confirms the output is already valid.
- Bootstrap and merged evaluate+learning stages now reuse their structural validators both for normal post-exit validation and for early termination when valid output is seen before subprocess exit.

### Fixed
- Resolved the bootstrap/resume hang where the monitor alternated indefinitely between `Analyzing instructions...` and `validating output...` even after the subprocess had already emitted a valid payload.
- Prevented stuck subprocesses from blocking `/idea-refine` and `/idea-refine-resume` until inactivity timeout by converting repeated assistant-response loops into deterministic terminal failures.
- Eliminated the risk of later looping assistant messages overwriting an already-captured valid stage result before process shutdown.

## 1.8.1 - 2026-05-05

### Added
- Progressive marker-matching in `extractMarkedSections` with 4 strategies: strict, same-line content, markdown-code-fence stripping, and lenient whitespace matching.
- Diagnostic context in marker-extraction errors: lists all missing/insufficient sections, reports begin/end marker counts, and shows a text snippet near the first missing marker.
- Test coverage for same-line markers, code-fence stripping, lenient matching, diagnostic errors, and batch missing-section reporting.

### Changed
- `extractMarkedSections` now tries progressively more lenient regex patterns before failing, reducing bootstrap and evaluate-stage failures caused by minor LLM output formatting variations.
- Error messages from `extractMarkedSections` now list all missing and insufficient sections at once instead of failing on the first one.

### Fixed
- Bootstrap stage `"Missing marked section for DIRECTIVE.md"` error that caused the entire workflow to stall after 3 retries, even when the LLM output contained the correct markers in a slightly different format (e.g. wrapped in markdown code fences, content on same line, or no newline before end marker).
- Wrapped `writeMarkdownFile` calls in bootstrap and evaluate retry catch-blocks with their own try/catch, preventing a secondary empty-content write error from masking the original extraction failure and blocking the retry loop.

## 1.8.0 - 2026-05-05

### Added
- Authoritative critical-write denominator constants for workflow-critical root artifacts and per-loop snapshots, making atomic persistence coverage explicit in code and tests.
- Regression coverage for interrupted writes, collision-safe workspace allocation, partial-start allocation recovery, missing-score retries, malformed-score retry exhaustion, and concurrent new/resume workflow isolation.

### Changed
- Updated `README.md` to document the 1.8.0 hardening release, including atomic persistence, collision-safe call-directory allocation, retryable score gating, expected runtime patience, and the virtual/simplified Epsilon-greedy exploration/exploitation behavior used inside a run.
- Replaced call-workspace allocation in `lib/workflow.ts` with exclusive directory reservation through `lib/path-utils.ts`.
- Routed resume-time artifact seeding through the hardened atomic text persistence helper instead of direct file copies.

### Fixed
- Hardened critical workflow persistence in `lib/io.ts` and `lib/manifest.ts` using same-directory temp writes, file flush, and atomic rename semantics.
- Eliminated `artifacts_call_NN` race conditions during concurrent starts and pre-existing partial-target scenarios.
- Made `FEEDBACK.md` overall score validation a retryable evaluate-stage gate, with preserved raw-attempt evidence and clean terminal failure after retry exhaustion.
- Prevented successful loop completion with `loopEntry.score = undefined` when `FEEDBACK.md` lacks a valid `Overall score: NN/100` line.

## 1.7.0 - 2026-05-05

### Added
- Explicit `/idea-refine-resume` command for resuming failed runs from existing `docs/idea_refinement/artifacts_call_NN/` artifacts.
- Resume analysis flow that accepts either a failed run path or the execution index `NN` and lets the user define a new final loop target.
- Interactive workaround-instruction capture for resumed runs, with context-aware prefilled analysis shown in the editor.
- `RESUME_CONTEXT.md` generation in resumed runs for auditability and prompt grounding.
- Resume-aware manifest metadata describing the source failed run, last consistent loop, failure category, and workaround instructions.
- Regression coverage for resuming from both loop-stage failures and bootstrap failures.

### Changed
- Resume workflows now seed themselves from the last consistent loop instead of trusting partially failed loop artifacts.
- Resume execution can intelligently skip bootstrap when the failed source run already has a structurally consistent bootstrap state.
- Resume execution can continue to a user-specified final loop target rather than being forced to the original requested loop count.

### Fixed
- Enabled recovery from failed runs regardless of failure category by deterministically analyzing the failed manifest and artifact set before resuming.
- Preserved the standard `/idea-refine` workflow unchanged while isolating resume behavior behind the dedicated resume command/flow.

## 1.6.1 - 2026-05-05

### Changed
- Delayed `stage_completed` signaling in `lib/workflow.ts` until after structural output validation succeeds, preventing misleading completion messages for invalid stage payloads.
- Added structural stage-result validation support to `runManagedStage()` so stage success is gated by parseable artifact output, not just subprocess exit.

### Fixed
- Added retry handling for the merged evaluate+learning stage when `FEEDBACK.md`, `LEARNING.md`, or `BACKLOG.md` markers are missing or truncated.
- Persisted raw failed evaluate attempts to `loops/loop_NN/evaluate-raw-attempt-N.md` for forensic recovery and auditing.
- Added regression coverage for truncated evaluate output recovery in `tests/lib/workflow.test.ts`.
- Eliminated the failure mode where a truncated evaluate response could abort the entire workflow after a technically successful subprocess run.

## 1.6.0 - 2026-05-05

### Added
- `userPromptTransport` support in `lib/runner.ts`, including a `stdin` transport mode for controlled subprocess prompt delivery.
- Spawned-boundary argv capture tests in `tests/lib/runner.test.ts` with exact sentinel occurrence assertions.
- New C3 regression fixtures in `tests/lib/response-validator.test.ts` for stray pipe rows outside the alternatives matrix and a valid in-section control matrix.
- Session governance artifacts for `docs/idea_refinement/artifacts_call_02/`: inspected-source ledger, environment dependency ledger, and prompt-transport pilot documentation.

### Changed
- Scoped C3 alternatives counting to the `## Minimum alternatives matrix` section in `lib/response-validator.ts`.
- Limited the production `stdin` prompt-transport pilot to the final checklist stage through `lib/workflow.ts`.
- Tightened workflow prompt/rule text in `lib/prompts.ts` to reject ledger-free metric claims, setup-only after-states, vague cost labels, and non-decision narrative.
- Recomputed local `artifacts_call_02` backlog and metrics from explicit ledger-backed evidence.
- Refined the monitor widget copy in `lib/ui-monitor.ts` from `tool: ... | spinner: ...` to `working...`.
- Updated `README.md` to document the 1.6.0 session changes, section-aware validation, and the checklist-stage stdin pilot.

### Fixed
- Eliminated the C3 false-positive path where stray `|` rows outside the alternatives matrix could satisfy matrix validation.
- Established a measurable raw-argv prompt baseline (`1`) and a verified harness-level pilot target (`0`) for checklist-stage prompt transport.

## 1.5.1 - 2026-05-05

### Fixed
- Excluded `IMPROVEMENTS.md`, `docs/`, test files, and local runtime folders from the published npm package via `.npmignore`.

## 1.5.0 - 2026-05-05

### Added
- Pause/resume control for active workflows via `Ctrl+Alt+P` and `/idea-refine-pause`.
- Stop control for active workflows via `Ctrl+Alt+X` and `/idea-refine-stop`.
- Runtime control layer for workflow subprocesses with elapsed-time tracking.
- Animated extension-managed status spinner and elapsed timer in the monitor/status line.
- Additional test coverage for runtime control, subprocess restrictions, inactivity timeout handling, and artifact snapshot behavior.
- New `CHANGELOG.md` for release tracking.

### Changed
- Replaced absolute stage timeout with inactivity timeout semantics; activity from agent/tool events resets the timer.
- Restricted subprocess agents to `read`, `bash ls`, `bash tree`, and `edit` only within `docs/idea_refinement/`.
- Blocked direct `write` usage inside subprocess agents; artifact persistence remains owned by the parent extension.
- Updated development-stage prompts so invoked agents treat project source as read-only.
- Switched C7 snapshot checks from project source files to refinement artifacts.
- Removed creation of empty `logs/` subdirectories inside `loops/loop_NN/`.
- Updated `README.md` to document shortcuts, monitor behavior, restricted tools, and current artifact layout.

### Removed
- `IMPROVEMENTS.md` and tracked `docs/idea_refinement/` artifacts from future project revisions.
