# Backlog

## P0 — Criterion Blockers (Loop 2 Gate)

### 1. Validator Consolidation
- **Problem:** `response-validator.ts` and `validator-check.ts` both contain duplicate c1-c5/c8 regex checks. CRITERIA.md requires only one module. [FACT: IDEA.md §5]
- **Action:** Build regression test battery capturing both scoring schemes (85 vs 100), then merge into `validateResponse(response, strictness: 'fast' | 'full')`.
- **Status:** Pending
- **Dependencies:** None
- **Revision Criterion:** If any rule is lost, restore immediately and add test. Must pass `tsc --noEmit` and full test battery.

### 2. Manifest Write Debounce with Baseline
- **Problem:** ~15-20 full JSON rewrites per run. CRITERIA.md requires 50% reduction. [FACT: IDEA.md §2]
- **Action:** (a) Instrument `manifestWriteCount` and run 3-loop fixture to establish M2 baseline. (b) Implement dirty-flag flush (2 s timer + stage boundary + SIGTERM). (c) Re-run same fixture to prove ≥50% drop.
- **Status:** Pending
- **Dependencies:** None
- **Revision Criterion:** If crash recovery loses >1 s of state, tighten flush to 500 ms. If reduction <50%, redesign flush strategy.

### 3. Artifact-Guard Async Cache
- **Problem:** `isRootInTerminalState` performs sync `existsSync` + `readFileSync` + `JSON.parse` on every `tool_call`. CRITERIA.md requires mean <1 ms per call. [FACT: IDEA.md §8]
- **Action:** Maintain in-memory `Set<string>` of terminal-state roots; invalidate only when `saveManifest` transitions a root to `success`/`failed`.
- **Status:** Pending
- **Dependencies:** Item 2 (align cache invalidation with flush timing)
- **Revision Criterion:** If cross-process staleness is detected, add mtime or manifest version bump check.

## P1 — Measured Optimization

### 4. Snapshot Scope + Bounds Verification
- **Problem:** `takeSnapshot` walks entire project tree unbounded. [FACT: IDEA.md §3, §13]
- **Action:** (a) Establish M4 baseline (file count before scope). (b) Apply `scope: ['lib','tests']`, `maxDepth: 6`, `maxFiles: 5000`. (c) Re-run same fixture to prove scan reduction and correct diff detection.
- **Status:** Implemented (unverified)
- **Dependencies:** None
- **Revision Criterion:** Revert to full scan if any legitimate mutation outside scope is missed.

### 5. Prompt Delta Delivery Baseline
- **Problem:** Full 9-artifact list rebuilt every stage; no M3 baseline. [FACT: IDEA.md §4]
- **Action:** Measure character count of `buildDevelopmentUserPrompt` on loop 1. In loop 2+, inject only changed artifacts + static index reference; measure again.
- **Status:** Pending
- **Dependencies:** Stable artifact naming (already present)
- **Revision Criterion:** Revert if token reduction <30% or output quality drops.

## P2 — Architectural Bets

### 6. Subprocess Batching / Persistent Session
- **Problem:** Cold-start tax per stage (~2-10 s). [FACT: IDEA.md §1, §11]
- **Action:** Research Pi CLI session API. If unavailable, prototype batched evaluate+learning prompt.
- **Status:** Deferred
- **Dependencies:** M1 baseline; confirmed Pi API capability
- **Revision Criterion:** If batched prompt causes >10% quality regression in blind review, revert to separate stages.

## P3 — Deferred / Blocked

### 7. UI Render Throttling & Log Regex
- **Problem:** 80 ms spinner, unthrottled widget, O(lines×patterns) log filtering. [FACT: IDEA.md §7, §12]
- **Action:** Reduce spinner to 160 ms, throttle widget to 1 s, compile `KEEP_RE` regex.
- **Status:** Deferred until P0 items resolved and verified.
- **Dependencies:** None
- **Revision Criterion:** If user feedback reports lag, raise spinner to 120 ms.

### 8. Parallelize Final Stages
- **Problem:** `report` + `checklist` are independent but serial. [FACT: IDEA.md §11]
- **Action:** `Promise.all` with buffered manifest updates.
- **Status:** Discarded for now.
- **Dependencies:** Item 2 (safe concurrent manifest writes)
- **Revision Criterion:** Revisit after append-only manifest or single-writer flush is proven.
