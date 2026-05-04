# Learning Base — Idea Refinement Performance

## Process Rigor (Hard Lessons)
- **Evidence-free claims are void.** Loop 1 tagged changes `[EXECUTED]` without diffs, test output, or counter values. FEEDBACK scored material result 37/100. Every implementation claim must attach a code diff, metric value, or `tsc` trace.
- **Baseline-before-behavior is mandatory.** CRITERIA.md Final Decision rule 1 requires a baseline measurement before adoption. Loop 1 adopted optimizations before measuring M1–M5. This is now the gating rule for all future items.
- **Cosmetic optimizations fail when criteria are blocked.** UI throttling and log-regex compilation do not address Minimum Before/After failures (duplicate validators, manifest writes, artifact-guard sync). They must yield to criterion-blockers.

## Validated / Falsified
- **Pi session reuse:** Falsified for now. `lib/runner.ts` hardcodes `--no-session`; no CLI API surface exposes persistent sessions. [FACT: runner.ts excerpt]
- **Snapshot scope benefit:** Unverified. Scoping to `lib/` + `tests/` claimed implemented but no M4 baseline provided. Treated as pending proof.
- **Loop 1 strategy (cosmetics-first):** Falsified. FEEDBACK verdict: ADJUST. Next loop must prove criterion-blockers before any new cosmetic work.

## Active Hypotheses
1. **Batched evaluate+learning prompt** reduces invocations by 1/loop without quality loss. [HYPOTHESIS] — Deferred until M1 baseline exists.
2. **Delta-prompting** cuts token volume ≥40% after loop 1. [HYPOTHESIS] — Deferred until M3 baseline exists.
3. **Append-only manifest** (`run.ndjson`) turns O(n) JSON rewrite into O(1) append. [HYPOTHESIS] — Requires manifest debounce proof first.
4. **Scoped snapshot** (`lib/`, `tests/`) cuts scan volume >50% on large codebases. [HYPOTHESIS] — Requires M4 baseline.

## Known Risks
- **State leakage:** Single Pi session may leak context between loops. [RISK]
- **Constraint drift:** Delta-prompting may cause model to forget static artifact constraints. [RISK]
- **Manifest race:** Parallel stages risk corrupting `run.json` without single-writer flush. [RISK]
- **Validator merge:** Consolidating two files risks dropping a check. [RISK] → Mitigation: regression test battery first.

## Provisional Decisions
- Do not touch random number generation. [DECISION: immutable constraint]
- No behavior change without baseline measurement on a fixed fixture. [DECISION]
- Criterion-blocking items (validators, manifest writes, artifact-guard) take absolute priority over UI/logging cosmetics. [DECISION]
- Merge validators only after a regression test battery guarantees no rule loss. [DECISION]
- Snapshot scope and log-regex are kept only if verified with numbers in loop 2; otherwise discarded. [DECISION]

## Discards
- **Mersenne Twister replacement:** Excluded by request. [DISCARD]
- **SHA-256 → xxhash:** Native addon dependency cost exceeds gain. [DISCARD]
- **Parallelize report+checklist:** Unsafe until manifest write serialization is resolved. [DISCARD]
- **Cosmetic-only iteration strategy:** Invalidated by FEEDBACK. [DISCARD]
