# Troubleshooting

## FIXED: `reasoning` field rejected by provider (v1.10.0+)

### Symptom

```
Error: 400 Error from provider: Extra inputs are not permitted, field: 'messages[2].reasoning', value: 'Let me first read the IDEA.md file to understand the original idea before generating the artifacts.'
```

### Root Cause

When `--thinking` is passed to the pi subprocess, some LLM providers (e.g., `opencode-go/mimo-v2.5-pro`) return reasoning/thinking content in their responses. When pi reconstructs the conversation history for the next turn, it includes a `reasoning` field on the message object. Providers that do not support this field reject it with a 400 error.

### Fix (v1.10.0)

`runManagedStage()` in `lib/workflow.ts` now automatically detects this specific provider error and retries the stage **without the thinking level**. No user action required — the workflow self-heals.

**Detection pattern:**
```typescript
/Extra inputs are not permitted.*reasoning/i
/messages\[\d+\]\.reasoning/i
```

**Behavior:** When the error is detected and a `thinkingLevel` was set, the stage is retried with `thinkingLevel: undefined`. A status message `⚠ Provider does not support thinking mode — retrying without it...` is displayed.

### Workaround (pre-v1.10.0)

If using an older version, set the thinking level to `none` or `off` before running `/idea-refine`:

```
/thinking none
/idea-refine
```

---

## FIXED: REPORT.md missing required headings (v1.11.0+)

### Symptom

```
Error: REPORT.md is missing required heading(s): # Investigation Report

Error: Workflow failed: REPORT.md is missing required heading(s): # Investigation Report

Error: Idea refinement workflow failed: REPORT.md is missing required heading(s): # Investigation Report
```

### Root Cause

The LLM generating REPORT.md or CHECKLIST.md sometimes does not include all mandatory headings specified in the system prompt. This can happen due to:
- Model hallucination or creative interpretation of instructions
- Context length limitations causing truncation of the prompt
- Provider-specific behavior differences

### Fix (v1.11.0)

`runFinalStages()` in `lib/workflow.ts` now retries report and checklist generation **up to 3 times** when required headings are missing. On each retry:

1. The previous stage is reset to `pending` status via `markStagePending()`
2. The original user prompt is reinforced with the explicit error message listing the missing headings
3. A status message `⚠ Report/Checklist missing headings — retrying (attempt N/3)...` is displayed

### Required Headings

**REPORT.md:**
- `# Investigation Report`
- `## Executive summary`
- `## Context and investigation object`
- `## Applied methodology`
- `## Main findings (by criterion)`
- `## Score evolution (consolidated scoreboard)`
- `## Firm decisions and active hypotheses`
- `## Identified risks and mitigations`
- `## Final recommendations`
- `## Cross-references (artifacts by loop)`

**CHECKLIST.md:**
- `# Action Checklist`
- `## Immediate actions (P0)`
- `## Short-term actions (P1)`
- `## Medium-term actions (P2)`
- `## Long-term actions (P3)`
- `## Dependencies between actions`
- `## Acceptance criteria per action`
