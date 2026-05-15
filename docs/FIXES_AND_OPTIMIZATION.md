# Fixes and Optimization Plan — `@apolosan/idea-refinement`

Scan date: 2026-05-15
Implementation branch status: implementation started for release **1.10.0**.

## 1. Executive Summary

The project was already in a solid functional state: type checking passed, the test suite passed, and the package could be packed successfully. The scan nevertheless identified issues in security hardening, subprocess isolation, output parsing, workflow correctness, manifest governance, release hygiene, documentation consistency, and long-term maintainability.

The recommended comprehensive change is the **1.10.0 — Hardening, Reliability & Release Hygiene** package. It is organized around these workstreams:

1. **Security and subprocess isolation**: prevent symlink/realpath escapes, reduce unsafe path assumptions, and restrict resume sources to the active project.
2. **Workflow correctness**: enforce loop limits in the core API, lock command startup earlier, and record stage success only after output persistence.
3. **Output parsing and validation**: separate strict success parsing from recovery parsing, validate final artifacts, and improve validator-check output.
4. **Manifest integrity**: validate enums, ranges, loop uniqueness, and cross-field invariants.
5. **UI/runtime behavior**: align the monitor with the combined evaluate+learning stage and reduce aggressive heartbeat updates.
6. **CI, release, and dependencies**: resolve the high-severity transitive vulnerability, run audit in CI, and consolidate duplicate workflows.
7. **Maintainability**: remove dead code, enable stricter TypeScript checks, and prepare future modularization.
8. **Documentation and packaging**: preserve ADR documentation while excluding generated run artifacts.
9. **Language standardization**: convert all versioned source and documentation text to **American English**.

## 2. Evidence Collected

| Check | Result |
|---|---:|
| `npm run typecheck` before implementation | passed |
| `npm test` before implementation | passed |
| `npm pack --dry-run --json` before implementation | passed |
| `npm audit --json` before implementation | 1 high-severity vulnerability |
| `npm outdated --json` before implementation | 2 outdated packages |

Key dependency issue:

- Vulnerable chain: `@mariozechner/pi-coding-agent@0.72.1 > @mariozechner/pi-ai@0.72.1 > @aws-sdk/client-bedrock-runtime > @aws-sdk/core > @aws-sdk/xml-builder > fast-xml-parser > fast-xml-builder@1.1.5`.
- Required fix: override or upgrade to a safe `fast-xml-builder` version and enforce `npm audit --audit-level=high`.

## 3. Implemented Changes in 1.10.0

### 3.1 Security and path isolation

Implemented files:

- `lib/path-guards.ts`
- `artifact-guard.ts`
- `tests/lib/path-guards.test.ts`
- `tests/lib/artifact-guard.test.ts`

Implemented changes:

- Added realpath-aware path containment helpers.
- `read` guard now rejects project-local symlinks that resolve outside the project.
- `bash` inspection guard now validates `ls`/`tree` targets both lexically and by realpath.
- `edit` guard now rejects symlink escapes from the protected call workspace.
- Added regression tests for read and edit symlink escapes.

Acceptance criteria:

- A symlink inside the project pointing outside the project is blocked.
- A symlink inside a completed protected root pointing outside the workspace is blocked.
- Normal paths inside the project/workspace continue to work.

### 3.2 Workflow loop limits and startup locking

Implemented files:

- `lib/workflow-limits.ts`
- `index.ts`
- `lib/workflow.ts`
- `tests/lib/workflow-limits.test.ts`

Implemented changes:

- Centralized loop count policy with `LOOP_COUNT_SOFT_CONFIRM_THRESHOLD` and `LOOP_COUNT_HARD_LIMIT`.
- Enforced loop count bounds in `runIdeaRefinementWorkflow()` and `runIdeaRefinementResumeWorkflow()`, not only in the UI layer.
- Moved command-level `runInProgress` locking earlier, before prompt collection.
- Reduced heartbeat frequency from 120ms to 300ms.

Acceptance criteria:

- Invalid workflow API loop counts are rejected.
- Duplicate command starts are reduced by acquiring the run lock before interactive prompts.

### 3.3 Resume source hardening

Implemented file:

- `lib/workflow.ts`

Implemented changes:

- Resume sources must be `artifacts_call_NN` directories under `docs/idea_refinement` for the active project.
- Absolute paths are allowed only when they resolve inside the active project's idea-refinement root.
- Realpath validation prevents symlink-based resume escapes.

Acceptance criteria:

- External resume sources are rejected.
- Valid in-project resume sources continue to work.

### 3.4 Strict marker parsing

Implemented files:

- `lib/marker-parser.ts`
- `tests/lib/marker-parser.test.ts`

Implemented changes:

- Marker canonicalization now preserves a single documented format: `<<<BEGIN FILE: NAME>>>` / `<<<END FILE: NAME>>>`.
- Strict parsing requires complete begin/end marker pairs by default.
- Missing-end-marker recovery is available only through explicit `allowSequentialBegins` mode.
- Tests now verify that begin-only streams fail by default and pass only in recovery mode.

Acceptance criteria:

- Truncated success payloads without `END` markers are not accepted silently.
- Recovery parsing remains available for diagnostics/raw-attempt use.

### 3.5 Final artifact validation and persistence alignment

Implemented files:

- `lib/final-artifact-validator.ts`
- `lib/workflow.ts`
- `tests/lib/final-artifact-validator.test.ts`
- `tests/lib/workflow.test.ts`

Implemented changes:

- Added structural validators for `REPORT.md` and `CHECKLIST.md` headings.
- Final stages now reject missing required headings.
- Stage output persistence is executed before the stage is marked successful.
- The combined evaluate+learning flow emits a synthetic learning completion event for the UI monitor.

Acceptance criteria:

- Incomplete final artifacts fail validation.
- A stage is not marked successful before its output is persisted.
- The monitor can show `learning` as completed in the combined stage flow.

### 3.6 Manifest normalization hardening

Implemented file:

- `lib/manifest.ts`

Implemented changes:

- Validates stage names instead of casting arbitrary strings.
- Validates directive policy values.
- Validates random numbers, scores, validator score, exit code, and usage cost ranges.
- Rejects `completedLoops > requestedLoops`.
- Rejects duplicate loop numbers.

Acceptance criteria:

- Corrupted manifests fail with explicit diagnostic messages.
- Legacy valid manifests still normalize successfully.

### 3.7 Validator-check report hardening

Implemented file:

- `lib/validator-check.ts`

Implemented changes:

- Escapes Markdown table cells.
- Uses relative paths when `cwd` is available.
- Uses `validateResponse(...).passed` instead of duplicating score logic.
- Keeps validator output non-blocking and audit-friendly.

Acceptance criteria:

- Validator reports remain valid Markdown even when details contain pipes, newlines, or backticks.
- Manifest recording uses stable relative output paths.

### 3.8 Snapshot hardening

Implemented file:

- `lib/post-hoc-check.ts`

Implemented changes:

- Snapshot scopes are validated lexically and by realpath.
- File hashes are computed by stream instead of reading entire files into memory.
- Scope escapes are skipped rather than traversed.

Acceptance criteria:

- Snapshot collection cannot be redirected outside the extension root through crafted scope paths or symlinks.
- Large files do not require full-content string reads for hashing.

### 3.9 Release and CI hygiene

Implemented files:

- `package.json`
- `package-lock.json`
- `.github/workflows/ci.yml`
- `.github/workflows/test.yml` (removed)
- `.gitignore`
- `.npmignore`

Implemented changes:

- Added an override to resolve the vulnerable `fast-xml-builder` transitive dependency.
- Updated lockfile to use `fast-xml-builder@1.2.0`.
- Added `npm audit --audit-level=high` to CI and `release:check`.
- Switched package dry-run to JSON output in CI/release check.
- Removed duplicate GitHub Actions workflow configuration.
- Ignored generated `docs/idea_refinement` artifacts while allowing ADR documentation to be versioned and packaged.
- Bumped package version to `1.10.0`.

Acceptance criteria:

- `npm audit --audit-level=high` passes.
- CI has one authoritative workflow.
- Package contents include intended public documentation and exclude generated run artifacts.

### 3.10 TypeScript and maintainability hardening

Implemented files:

- `tsconfig.json`
- `lib/runner.ts`
- affected tests

Implemented changes:

- Enabled `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`.
- Removed a dead JSON-string extraction helper from `lib/runner.ts`.
- Cleaned unused test variables/imports discovered by stricter TypeScript checks.

Acceptance criteria:

- `npm run typecheck` passes with stricter unused-code checks.

### 3.11 American English standardization

Implemented files:

- `README.md`
- `CHANGELOG.md`
- `docs/FIXES_AND_OPTIMIZATION.md`
- Additional versioned documentation should follow this rule.

Implemented changes:

- Public release notes and active project documentation were converted to American English.
- The project language policy is now explicit: versioned source code, comments, prompts, UI messages, tests, and public documentation should use American English.

Acceptance criteria:

- No Portuguese text should remain in versioned source or public documentation, except historical generated artifacts under `docs/idea_refinement`.

## 4. Remaining Recommended Follow-ups

The following items are still recommended for future work if they were not fully completed in this implementation pass:

1. Add a dedicated language-regression CI check that blocks common Portuguese terms in versioned files outside an explicit allowlist.
2. Add retry/raw-attempt capture for final `REPORT.md` and `CHECKLIST.md` validation failures, mirroring bootstrap/evaluate retries.
3. Split large modules into smaller domains:
   - `lib/workflow/`
   - `lib/runner/`
   - `lib/manifest/`
   - `lib/ui/`
4. Add coverage tooling with `c8` or migrate gradually to `node:test`.
5. Add a pack-content verification script that checks README/CHANGELOG links against package contents.
6. Test against the minimum and latest supported `@mariozechner/pi-coding-agent` peer versions.

## 5. Verification Checklist

Required verification before publishing:

1. `npm run typecheck`
2. `npm test`
3. `npm audit --audit-level=high`
4. `npm pack --dry-run --json`
5. Review `git diff --stat` and `git status --short`.
6. Confirm npm authentication with `npm whoami`.
7. Confirm Git remote and branch before pushing.
8. Publish only after all checks pass.

## 6. Release Notes Summary

Release **1.10.0** should be described as a hardening and reliability release. It strengthens subprocess containment, validates workflow boundaries, rejects unsafe resume sources, improves parsing and final artifact validation, records stage success more accurately, resolves the high-severity audit finding, consolidates CI, and standardizes public project text on American English.
