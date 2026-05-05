# Idea Refinement Extension

A [Pi Coding Agent](https://pi.dev) extension that enforces, by code and in strict sequence, an iterative idea-refinement workflow.

## What It Is

Think of it as **autoresearch** — inspired by the concept Andrej Karpathy popularized — but without the GPU cluster. Instead of training a model, the extension trains the *agent itself* while it analyzes an idea proposal or problem solution. Each loop forces the agent to develop, critique, and learn from its own output, progressively sharpening its understanding of the problem space.

While it is designed to refine raw ideas into actionable plans, it works just as powerfully for **intelligent and convincing problem solving**: feed it a bug, an architectural tension, a product decision, or a research question, and the workflow will dissect it, propose alternatives, evaluate them with epistemic rigor, and deliver a prioritized checklist of next steps.

A practical note for users: this procedure is intentionally methodical, so it can take a while depending on the number of loops and the complexity of the subject. It is worth approaching it with a bit of patience — the extension is not trying to answer quickly, but to answer better.

## What's New in 1.8.0

This release hardens the workflow engine in the areas that most affect auditability, recoverability, and deterministic execution:

- critical workflow artifacts are now persisted through **atomic-by-default writes** (same-directory temp file + flush + rename), reducing partial-write risk for files such as `run.json`, `DIRECTIVE.md`, `LEARNING.md`, `BACKLOG.md`, `REPORT.md`, and `CHECKLIST.md`;
- `artifacts_call_NN` allocation is now **collision-safe**, using exclusive directory creation with bounded retry instead of a fragile scan-then-create sequence;
- the evaluate stage now treats a valid `Overall score: NN/100` in `FEEDBACK.md` as a **required success gate** rather than a best-effort parse;
- missing or malformed overall scores are now handled as **retryable validation failures**, preserving raw attempt captures before the workflow fails definitively after retry exhaustion;
- resume seeding now routes copied critical artifacts through the same hardened persistence path;
- regression coverage was expanded to cover interrupted writes, concurrent allocation, partial-start allocation, score-gate retries, and retry exhaustion.

## Installation

### Via Pi (recommended)

```bash
pi install npm:@apolosan/idea-refinement
```

Or for local project installation:

```bash
pi install -l npm:@apolosan/idea-refinement
```

### Via npm

```bash
npm install -g @apolosan/idea-refinement
```

Then add it to your Pi `settings.json`:

```json
{
  "packages": ["npm:@apolosan/idea-refinement"]
}
```

## Prerequisites

- **Node.js ≥ 22** (uses `--experimental-strip-types`)

## What It Does

With the `/idea-refine` command, the extension:

1. captures your idea;
2. asks how many development loops to run;
3. generates the initial artifacts:
   - `DIRECTIVE.md`
   - `LEARNING.md`
   - `CRITERIA.md`
   - `DIAGNOSIS.md`
   - `METRICS.md`
   - `BACKLOG.md`
4. executes, for each loop:
   - idea development → `RESPONSE.md`
   - combined critical evaluation + learning update → `FEEDBACK.md`, `LEARNING.md`, `BACKLOG.md`
5. after all loops, consolidates → `REPORT.md` and `CHECKLIST.md`
6. stores everything in an isolated directory per invocation;
7. displays real-time workflow progress through multiple persistent UI channels:
   - console/chat notifications for start, stage transitions, loop completion, pause/resume, stop, and failures;
   - current loop and total loops;
   - textual loop progress bar;
   - current workflow stage;
   - active tool being executed;
   - total elapsed time;
   - animated status spinner maintained by the extension itself.

## How to Use

In Pi, run:

```text
/idea-refine
```

Or, for a short idea:

```text
/idea-refine I want to validate a platform for AI-assisted technical interviews.
```

After that, the extension will ask for the number of loops.

> **Recommendation:** choose the loop count with realism in mind. More loops usually mean better refinement, but they also mean more processing time. A little patience is part of the design: the workflow compounds insight step by step rather than rushing to a shallow conclusion.

### Runtime shortcuts

While a workflow is running:

- `Ctrl+Alt+P` → pause / resume the workflow
- `Ctrl+Alt+X` → stop the workflow

Equivalent commands are also available:

- `/idea-refine-pause`
- `/idea-refine-stop`
- `/idea-refine-resume`

### Resuming a failed run

Use:

```text
/idea-refine-resume
```

or pass the execution index/path directly:

```text
/idea-refine-resume 4
```

```text
/idea-refine-resume docs/idea_refinement/artifacts_call_04
```

The resume flow will:

1. inspect the failed run and identify the last consistent loop;
2. detect the failure category and whether bootstrap artifacts can be reused;
3. ask for the new final loop target;
4. open an editor prefilled with contextual analysis so you can provide workaround instructions;
5. start a new resumed run seeded from the last consistent state.

The standard `/idea-refine` workflow is not modified by this resume flow.

## Real-Time Monitor

During execution, the extension:

- publishes important events to the Pi console/chat (`workflow_started`, stage start/end, loop completion, pause/resume, stop, failures);
- updates a summarized `status` in the footer/working message;
- keeps a persistent widget with a checklist of bootstrap, development, evaluation, and learning stages;
- displays the `current tool` in use by the invoked subprocess;
- shows a textual progress bar of completed loops;
- shows total elapsed runtime;
- maintains an animated spinner in the extension status/widget even while subprocess agents are working.

These messages are emitted through distinct Pi UI channels (`setStatus`, `setWidget`, `setWorkingMessage`, and `notify`) so that status information remains visible and is not pruned by the agent interface.

## Directories and Artifacts

Each run creates an exclusive directory:

```text
docs/idea_refinement/artifacts_call_01/
docs/idea_refinement/artifacts_call_02/
...
```

Generated structure:

```text
docs/idea_refinement/artifacts_call_NN/
├── IDEA.md
├── DIRECTIVE.md
├── LEARNING.md
├── CRITERIA.md
├── DIAGNOSIS.md
├── METRICS.md
├── BACKLOG.md
├── RESPONSE.md          # latest version
├── FEEDBACK.md          # latest version
├── REPORT.md            # final consolidated report
├── CHECKLIST.md         # actionable checklist
├── validator-check-output.md  # epistemic validation result
├── run.json             # structured execution manifest
├── logs/
│   ├── bootstrap.jsonl
│   ├── loop_01_develop.jsonl
│   ├── loop_01_evaluate.jsonl
│   ├── report.jsonl
│   └── checklist.jsonl
└── loops/
    ├── loop_01/
    │   ├── RESPONSE.md
    │   ├── FEEDBACK.md
    │   ├── LEARNING.md
    │   └── BACKLOG.md
    └── loop_02/
        └── ...
```

## How Order Is Enforced

The extension does not rely on the current agent to orchestrate the process.

It itself:

- generates non-deterministic random numbers via Web Crypto API (CSPRNG with rejection sampling) to guide the workflow;
- uses an **Epsilon-greedy reinforcement learning strategy** to balance exploitation of what is already working with controlled exploration of alternatives;
- preserves that reinforcement-learning behavior **on the user's own machine**, so the refinement policy can keep improving locally even when the workflow is executed with third-party models — including heterogeneous setups that mix different model families;
- spawns its own `pi` subprocesses in sequence;
- injects stage-specific system prompts;
- captures the final text of each subprocess;
- writes artifacts by code;
- updates `run.json` throughout execution;
- enforces inactivity timeouts instead of absolute stage deadlines;
- allows pause/resume and stop control for the whole workflow.

## Prompt Transport and Validation Behavior

### Section-aware alternatives validation

The C3 validator now treats `## Minimum alternatives matrix` as the only valid scope for alternatives counting. Pipe-formatted rows outside that section no longer satisfy the matrix requirement.

### Checklist-stage stdin pilot

To reduce raw prompt exposure in subprocess argv, the extension now supports an internal prompt-transport mode that sends the real prompt through `stdin`. In this release, the production pilot is intentionally limited to the final `CHECKLIST.md` stage so the rollout stays reversible and easy to verify.

## Environment Variable

### `PI_IDEA_REFINEMENT_PROTECTED_ROOTS`

This environment variable is used internally by the extension to protect artifact directories from writes during workflow execution. The `artifact-guard.ts` blocks `write` and `edit` operations on protected paths until the workflow reaches a terminal state (`success` or `failed`). It also constrains subprocess agents to a restricted tool set.

**No manual configuration is required** — the extension sets it automatically when starting each subprocess.

## Implemented Safeguards

- `DIRECTIVE.md` is created once and never overwritten.
- `DIAGNOSIS.md`, `METRICS.md`, and `BACKLOG.md` make refinement more observable, comparable, and auditable.
- Each stage subprocess receives an auxiliary extension (`artifact-guard.ts`) that blocks direct `write`, restricts `bash` to `ls`/`tree`, and only allows `edit` within `docs/idea_refinement/`.
- Final artifact content is persisted only by the main extension.
- Each loop keeps its own snapshots in `loops/loop_NN/`.

## Implementation Decisions

- The active session model is reused across all stages.
- The active session thinking level is also propagated to workflow subprocesses.
- The real-time monitor is fed by structured events (`message_update`, `tool_execution_start`, `tool_execution_end`) emitted by each `pi --mode json` subprocess.
- Status animation is driven by the parent extension with its own heartbeat instead of depending only on Pi's default working indicator.
- Stage execution uses inactivity timeouts (default 5 minutes) rather than absolute wall-clock deadlines.
- Subprocess agents operate in read-only mode for the project source and can only inspect directories via `bash ls` / `bash tree`.
- The initial random number only defines the primary active policy in `DIRECTIVE.md`:
  - `1-80` → `OPTIMIZATION`
  - `81-100` → `CREATIVITY/EXPLORATION`
- `DIRECTIVE.md` always includes both policies (`OPTIMIZATION` and `CREATIVITY/EXPLORATION`); the draw only sets which one is marked in `Selected Policy`.
- Each loop's random number is forwarded to the development agent as a contextual seed, without the ability to overwrite the directive.
- The extension is kept modular to facilitate maintenance and testing.

## Tests

Run local tests with Node 22+:

```bash
node --experimental-strip-types tests/run-tests.ts
```

Tests cover:

- loop count parsing;
- next `artifacts_call_NN` detection;
- initial artifact marker parsing and `LEARNING.md` + `BACKLOG.md` update parsing;
- `Overall score` extraction;
- artifact path protection and subprocess tool restrictions;
- section-aware C3 validation, including stray-pipe rejection outside the matrix section;
- spawned-subprocess argv baseline capture and the `stdin` transport pilot;
- inactivity timeout handling;
- pause/resume/stop runtime control;
- elapsed time and animated monitor rendering;
- thinking level propagation to subprocesses;
- execution and thinking monitor in real time;
- smoke import of the main extension.

## License

MIT
