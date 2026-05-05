# Changelog

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
