# ADR 0001 — Response Validator Role

Status: Accepted (implementation aligns with this decision).

Date: 2026-05-15

## Context

The project runs a quality check (`validateResponse` in `lib/response-validator.ts`, orchestrated by `lib/validator-check.ts`) against the final `RESPONSE.md`. The check can identify weak structure, missing evidence, or low-scoring outputs after the main workflow finishes.

The open question was whether that validator should block workflow success or remain an offline QA signal.

## Decision

**Option B — offline QA with visibility.**

- The check **does not block** successful workflow completion or artifact persistence.
- The result is **persisted** next to the run (`validator-check-output.md`) and **recorded in the manifest** (`run.json`, fields under `auxiliaryFiles`) for auditability and quality-trend analysis.
- Validator failures are treated as diagnostics, without interrupting the user beyond existing end-of-workflow notifications.

## Consequences

- **Positive:** lower risk of blocking valid runs because of brittle heuristics; keeps a useful quality signal for human review and possible future promotion to a gate if the heuristics become strict enough.
- **Negative:** semantically weak content can still mark the workflow as `success`; go/no-go responsibility remains with a human reviewer or external release policy.
- **Operational:** `run.json` now stores `auxiliaryFiles.responseValidatorOutput` and `auxiliaryFiles.lastValidatorCheckScore` when available.

## Alternatives Considered

- **A — Promote to a gate:** would reject runs below the score threshold; risks false negatives while matching/counting heuristics remain imperfect.
- **C — Retire the validator:** would remove useful visibility that is already integrated into the extension and manifest.
