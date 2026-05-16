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
