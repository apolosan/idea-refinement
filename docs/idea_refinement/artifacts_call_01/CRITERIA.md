# CRITERIA

## Validation Vision
A valid improvement is one that reduces measurable wall-clock time or redundant work while preserving the correctness of stage outputs and the auditability of the workflow trace. [DECISION]

## Comparability Framework
Before/after comparisons MUST use the same project fixture, same loop count, and same model provider. [DECISION] Comparisons across different hardware or network conditions must be tagged as `[INFERENCE]`, not `[FACT]`. [DECISION]

## Minimum Before/After Criteria
- **Wall-clock time:** Total workflow duration must not increase; a 20% reduction on a 3-loop run is the success threshold. [DECISION]
- **Manifest writes:** Count of `saveManifest` calls must drop by at least 50% for a 3-loop run. [DECISION]
- **Prompt size:** Character count of user prompts after loop 1 must be ≤ 60% of loop 1's prompt size when delta-prompting is active. [DECISION]
- **Validator uniqueness:** Only one validation module may contain regex checks for c1-c5/c8; divergence between two files is a failure. [DECISION]
- **Event-loop blocking:** Synchronous file reads in `artifact-guard.ts` must be eliminated or cached; mean time per `tool_call` must be < 1 ms. [DECISION]

## Clarity
Each change must be describable in one sentence and locatable to a single file or function. [DECISION]

## Depth
Surface changes (e.g., constant tuning) are acceptable only if accompanied by a structural hypothesis (e.g., "throttle to 160 ms because human terminal perception is ~6 fps"). [DECISION]

## Distinction Between Alternatives
When multiple remediation paths exist (e.g., session reuse vs. batching vs. fast-restart flag), the chosen path must be justified by a falsifiable hypothesis, not by rhetorical preference. [DECISION]

## Actionability
Every approved proposal must be expressible as a discrete code edit with verifiable pre- and post-conditions. [DECISION]

## Operational Cost
The cost of a change is measured in: (a) lines of code added/removed, (b) new dependencies, (c) cognitive load on future maintainers, and (d) risk of altering the output contract. [DECISION] A change with high operational cost requires a proportionally higher predicted speed-up, evidenced by a prototype or measurement. [DECISION]

## Final Decision
A proposal graduates from backlog to implementation only when:
1. A baseline measurement exists. [DECISION]
2. A success threshold is defined. [DECISION]
3. A rollback procedure is documented. [DECISION]
4. No immutable rule is violated. [DECISION]
