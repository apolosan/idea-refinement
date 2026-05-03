# Idea Refinement Extension

A [Pi Coding Agent](https://pi.dev) extension that enforces, by code and in strict sequence, an iterative idea-refinement workflow.

## What It Is

Think of it as **autoresearch** — inspired by the concept Andrej Karpathy popularized — but without the GPU cluster. Instead of training a model, the extension trains the *agent itself* while it analyzes an idea proposal or problem solution. Each loop forces the agent to develop, critique, and learn from its own output, progressively sharpening its understanding of the problem space.

While it is designed to refine raw ideas into actionable plans, it works just as powerfully for **intelligent and convincing problem solving**: feed it a bug, an architectural tension, a product decision, or a research question, and the workflow will dissect it, propose alternatives, evaluate them with epistemic rigor, and deliver a prioritized checklist of next steps.

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
   - critical evaluation → `FEEDBACK.md`
   - cumulative learning update → `LEARNING.md`
5. stores everything in an isolated directory per invocation;
6. displays real-time workflow progress through multiple persistent UI channels:
   - console/chat notifications for start, stage transitions, loop completion, and failures;
   - current loop and total loops;
   - textual loop progress bar;
   - current workflow stage;
   - active tool being executed.

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

## Real-Time Monitor

During execution, the extension:

- publishes important events to the Pi console/chat (`workflow_started`, stage start/end, loop completion, failures);
- updates a summarized `status` in the footer/working message;
- keeps a persistent widget with a checklist of bootstrap, development, evaluation, and learning stages;
- displays the `current tool` in use by the invoked subprocess;
- shows a textual progress bar of completed loops.

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
│   └── loop_01_learning.jsonl
└── loops/
    ├── loop_01/
    │   ├── RESPONSE.md
    │   ├── FEEDBACK.md
    │   └── LEARNING.md
    └── loop_02/
        └── ...
```

## How Order Is Enforced

The extension does not rely on the current agent to orchestrate the process.

It itself:

- generates non-deterministic random numbers via Mersenne Twister + cryptographic entropy to guide the workflow;
- spawns its own `pi` subprocesses in sequence;
- injects stage-specific system prompts;
- captures the final text of each subprocess;
- writes artifacts by code;
- updates `run.json` throughout execution.

## Environment Variable

### `PI_IDEA_REFINEMENT_PROTECTED_ROOTS`

This environment variable is used internally by the extension to protect artifact directories from writes during workflow execution. The `artifact-guard.ts` blocks `write` and `edit` operations on protected paths until the workflow reaches a terminal state (`success` or `failed`).

**No manual configuration is required** — the extension sets it automatically when starting each subprocess.

## Implemented Safeguards

- `DIRECTIVE.md` is created once and never overwritten.
- `DIAGNOSIS.md`, `METRICS.md`, and `BACKLOG.md` make refinement more observable, comparable, and auditable.
- Each stage subprocess receives an auxiliary extension (`artifact-guard.ts`) that blocks `write` and `edit` on the artifact directory.
- Final artifact content is persisted only by the main extension.
- Each loop keeps its own snapshots in `loops/loop_NN/`.

## Implementation Decisions

- The active session model is reused across all stages.
- The active session thinking level is also propagated to workflow subprocesses.
- The real-time monitor is fed by structured events (`message_update`, `tool_execution_start`, `tool_execution_end`) emitted by each `pi --mode json` subprocess.
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
- artifact path protection;
- thinking level propagation to subprocesses;
- execution and thinking monitor in real time;
- smoke import of the main extension.

## License

MIT
