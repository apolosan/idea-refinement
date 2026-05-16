# Idea Refinement Extension

A [Pi Coding Agent](https://pi.dev) extension that enforces, by code and in strict sequence, an iterative idea-refinement workflow.

## What It Is

Think of it as **autoresearch** — inspired by the concept Andrej Karpathy popularized — but without the GPU cluster. Instead of training a model, the extension trains the *agent itself* while it analyzes an idea proposal or problem solution. Each loop forces the agent to develop, critique, and learn from its own output, progressively sharpening its understanding of the problem space.

While it is designed to refine raw ideas into actionable plans, it works just as powerfully for **intelligent and convincing problem solving**: feed it a bug, an architectural tension, a product decision, or a research question, and the workflow will dissect it, propose alternatives, evaluate them with epistemic rigor, and deliver a prioritized checklist of next steps.

A practical note for users: this procedure is intentionally methodical, so it can take a while depending on the number of loops and the complexity of the subject. It is worth approaching it with a bit of patience — the extension is not trying to answer quickly, but to answer better.

## What's New in 1.11.0

Release **1.11.0** focuses on automatic error recovery and self-healing workflow behavior.

Highlights:

- **Provider reasoning field auto-recovery**: `runManagedStage()` detects when an LLM provider rejects the `reasoning` field in messages (common with `opencode-go` and similar providers) and automatically retries the stage without the thinking level. No user intervention required.
- **Final-stage heading validation retry**: `runFinalStages()` retries report and checklist generation up to 3 times when required headings are missing. On each retry, the prompt is reinforced with the explicit list of missing headings to guide the LLM toward compliant output.
- **Stage reset support**: Added `markStagePending()` to `lib/manifest.ts` for clean stage reset during retry flows.

### Previous: 1.10.0

Release 1.10.0 focused on hardening, reliability, release hygiene, and language consistency, including realpath-aware subprocess guards, workflow correctness hardening, safer resume handling, parser/validator improvements, manifest/snapshot hardening, CI audit, and American English standardization.

## Recent: 1.8.7

Release 1.8.7 focused on bootstrap/evaluate extraction resilience when models emit incomplete marker closures. See `CHANGELOG.md` for full history.

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

## Supported platforms

- **Linux and macOS:** Full support, including pause/resume of the Pi subprocess via `SIGSTOP`/`SIGCONT` when the runtime exposes POSIX job control to Node child processes.
- **Windows:** POSIX `SIGSTOP`/`SIGCONT` are generally unavailable for Node child processes. Pause/resume shortcuts may not actually suspend the subprocess; prefer letting stages finish or using stop.

## Peer compatibility

This package declares a tested peer range for `@mariozechner/pi-coding-agent` (`>=0.72.0 <1.0.0`). Versions outside that range might work, but they are not part of the compatibility promise.

## What It Does

With the `/idea-refine` command, the extension:

1. captures your idea;
2. asks how many development loops to run, applying confirmation for runs above **20** loops and refusing values above the hard operational ceiling (**1000**);
3. reuses the current Pi session model and forwards the current thinking level into every workflow subprocess;
4. generates the initial artifacts:
   - `DIRECTIVE.md`
   - `LEARNING.md`
   - `CRITERIA.md`
   - `DIAGNOSIS.md`
   - `METRICS.md`
   - `BACKLOG.md`
5. executes, for each loop:
   - idea development → `RESPONSE.md`
   - combined critical evaluation + learning update → `FEEDBACK.md`, `LEARNING.md`, `BACKLOG.md`
6. after all loops, consolidates → `REPORT.md` and `CHECKLIST.md`
7. stores everything in an isolated directory per invocation;
8. displays real-time workflow progress through multiple persistent UI channels:
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

> **Recommendation:** choose the loop count with realism in mind. More loops usually mean better refinement, but they also mean more processing time. The extension now asks for explicit confirmation on unusually large loop counts and refuses values above the hard safety limit.

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
├── RESUME_CONTEXT.md    # present on resumed runs
├── logs/
│   ├── bootstrap.jsonl
│   ├── loop_01_develop.jsonl
│   ├── loop_01_evaluate.jsonl
│   ├── report.jsonl
│   ├── checklist.jsonl
│   └── guard-denials.jsonl
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
- uses a **virtual/simplified Epsilon-greedy exploration/exploitation strategy** (roughly 80/20 optimization vs. exploration) inside a run, using score feedback as a reward signal without claiming persisted local reinforcement-learning state across runs;
- reuses the active Pi model and forwards the current session thinking level into each subprocess invocation;
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

### Full stdin prompt transport

To reduce raw prompt exposure in subprocess argv, the extension sends workflow user prompts through `stdin` in all stages. This keeps the stage contracts unchanged while making prompt transport lighter and more uniform.

## Environment Variable

### `PI_IDEA_REFINEMENT_PROTECTED_ROOTS`

This environment variable is used internally by the extension to protect artifact directories during workflow execution. The `artifact-guard.ts` constrains subprocess agents to `read`, `bash`, and `edit`, blocks out-of-project reads, blocks absolute-path or out-of-scope `ls`/`tree`, blocks historical edits outside the active call, and persists denial audit records in `logs/guard-denials.jsonl`.

**No manual configuration is required** — the extension sets it automatically when starting each subprocess.

## Implemented Safeguards

- `DIRECTIVE.md` is created once and never overwritten.
- `DIAGNOSIS.md`, `METRICS.md`, and `BACKLOG.md` make refinement more observable, comparable, and auditable.
- Each stage subprocess receives an auxiliary extension (`artifact-guard.ts`) that blocks direct `write`, restricts directory inspection to `ls`/`tree` inside the active call workspace, blocks historical artifact edits, and records blocked attempts in `logs/guard-denials.jsonl`.
- Final artifact content is persisted only by the main extension.
- Each loop keeps its own snapshots in `loops/loop_NN/`.

## Implementation Decisions

- The active session model is reused across all stages.
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

Run local checks with Node 22+:

```bash
npm run typecheck
npm test
npm run test:ci
npm run release:check
```

Tests cover:

- loop count parsing;
- next `artifacts_call_NN` detection;
- initial artifact marker parsing and `LEARNING.md` + `BACKLOG.md` update parsing;
- `Overall score` extraction;
- artifact path protection and subprocess tool restrictions;
- section-aware C3 validation, including stray-pipe rejection outside the matrix section;
- spawned-subprocess argv baseline capture and full `stdin` prompt transport;
- inactivity timeout handling;
- pause/resume/stop runtime control;
- elapsed time and animated monitor rendering;
- execution and thinking monitor in real time;
- smoke import of the main extension.

## License

MIT
