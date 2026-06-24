# Ultra Loop

Ultra Loop is a durable, evidence-gated Open Dynamic Workflow example. It
repeatedly acquires a goal, runs an implementation agent, verifies evidence,
applies a checkpoint, and finishes with parallel quality reviews.

The workflow stores its own durable state under `.ultra-loop/` by default.
Agent execution reports and Open Dynamic Workflow artifacts remain under
`.open-dynamic-workflow/runs/`.

## Layout

```text
examples/ultra-loop/
├── config.yaml
├── tools/
│   ├── ultra-loop-acquire-next.js
│   ├── ultra-loop-checkpoint.js
│   ├── ultra-loop-create-run.js
│   ├── ultra-loop-ledger.js
│   ├── ultra-loop-quality-gate.js
│   ├── ultra-loop-record-evidence.js
│   ├── ultra-loop-status.js
│   └── ultra-loop-steer.js
└── workflows/
    ├── ultra-loop-round.js
    └── ultra-loop.js
```

Run commands from the repository root.

## Validate

```bash
odw validate examples/ultra-loop/workflows/ultra-loop.js \
  --config examples/ultra-loop/config.yaml
```

## Run

```bash
odw run examples/ultra-loop/workflows/ultra-loop.js \
  --config examples/ultra-loop/config.yaml \
  --arg brief="Implement the requested change"
```

The implementation agent always receives:

```js
permissions: { mode: "dangerously-full-access" }
```

This allows the implementation provider to modify the workspace and execute
commands without interactive approval. Run this workflow only in a workspace
where autonomous changes are acceptable. Evidence verification, checkpoint
review, quality review, and summary agents do not receive write permissions.

## Resume Durable State

The final report prints the Ultra Loop `runId`. Resume that durable run with:

```bash
odw run examples/ultra-loop/workflows/ultra-loop.js \
  --config examples/ultra-loop/config.yaml \
  --arg runId="<ultra-loop-run-id>"
```

This resumes Ultra Loop's durable goal and evidence state. It is separate from
the Open Dynamic Workflow `odw resume` command, which reuses cached workflow
calls from a previous ODW execution.

## Steering

Apply an auditable steering request while running or resuming:

```bash
odw run examples/ultra-loop/workflows/ultra-loop.js \
  --config examples/ultra-loop/config.yaml \
  --arg runId="<ultra-loop-run-id>" \
  --arg steeringDirective="Add regression coverage for cancellation"
```

If both `brief` and `runId` are supplied, also provide `resumePolicy`.

## Provider

All agents use the provider and model selected by configuration. The workflow
does not set per-agent `provider` or `model` values and does not expose provider
override arguments.

The supplied config uses the deterministic `mock` provider by default. Change
`defaultProvider` and its provider configuration in `config.yaml` to run the
entire workflow with another provider and that provider's default model.

## Durable Artifacts

The default durable state location is:

```text
.ultra-loop/runs/<run-id>/
├── brief.md
├── plan.json
├── ledger.jsonl
├── evidence/
├── locks/
├── quality-gates/
└── snapshots/
```

Override the root with:

```bash
--arg storageRoot=".local/ultra-loop"
```

Treat these files as sensitive. They may contain prompts, code references,
evidence, review findings, and model output.

## Completion Rules

Ultra Loop reports completion only when:

1. Every essential success criterion has recorded passing evidence.
2. The goal checkpoint accepts completion.
3. All goals are complete.
4. The final quality gate approves the run.
5. The aggregate checkpoint accepts completion.

An agent recommendation alone cannot mark a goal or run complete. Durable tool
state and checkpoint validation remain authoritative.
