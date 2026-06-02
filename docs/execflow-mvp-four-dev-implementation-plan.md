# execflow MVP Four-Developer Parallel Implementation Plan

**Product:** execflow  
**Document type:** MVP implementation plan  
**Date:** 2026-06-02  
**Audience:** Engineering team  
**Source inputs:** execflow PRD, execflow Architecture Design Document, execflow MVP Technical Design

---

## 1. Purpose

This plan breaks the execflow MVP into four parallel development lanes that can be executed by four developers with minimal blocking. It stays within the MVP scope defined in the technical design:

- `execflow run <workflow-file>`
- `execflow validate <workflow-file>`
- `execflow doctor`
- constrained workflow runtime
- `agent()`
- `parallel()`
- `phase()`
- `log()`
- Codex, Gemini, and mock providers
- global concurrency limit
- timeout handling
- durable artifacts
- event stream
- pretty, JSON, and JSONL reporters
- JSON Schema validation
- deterministic exit codes

The MVP intentionally excludes:

- `pipeline()`
- retries
- worktree isolation
- container isolation
- provider plugins
- resumable runs
- approval gates
- automatic patch application
- provider-level concurrency limits
- hosted dashboard or static HTML report

---

## 2. Team Split

| Developer | Ownership | Primary objective |
|---|---|---|
| Dev A | CLI, config, workflow parser, workflow validator | Make workflows loadable, validatable, and runnable from the command line |
| Dev B | Runtime, DSL, scheduler | Make `agent()`, `parallel()`, `phase()`, and `log()` execute correctly under concurrency, fail-fast, and cancellation rules |
| Dev C | Providers, process runner, structured validation | Make mock, Codex, and Gemini execute through one provider adapter path with timeouts and schema validation |
| Dev D | Artifacts, event bus, reporters, integration tests | Make every run observable, durable, reportable, and CI-testable |

The key integration rule is to freeze shared contracts first, then allow each developer to build behind those interfaces.

---

## 3. Phase 0: Shared Contract Freeze

**Owner:** All developers, led by Dev A  
**Goal:** Unblock parallel implementation by agreeing on stable interfaces and file structure.

### 3.1 Contracts to define first

```ts
AgentCallInput
AgentResult
AgentArtifacts
WorkflowRunResult
EventEnvelope
AgentAdapter
ProviderCommand
ProviderParsedResult
ProcessRunInput
ProcessRunResult
ArtifactStore
Reporter
ExecflowConfig
SerializedError
```

### 3.2 MVP decisions to lock

| Decision | MVP choice |
|---|---|
| Workflow language | JavaScript-first; TypeScript syntax only if trivial through tooling |
| `agent()` shape | Object-only: `agent({ id, provider, prompt, schema })` |
| `parallel()` shape | Support object and array forms; examples prefer object form for named results |
| `--provider` behavior | Sets default provider only; does not override explicit per-agent provider |
| Agent failure behavior | Return `AgentFailureResult`; do not throw from `parallel()` by default |
| Fail-fast default | Off |
| Retry | Not implemented |
| Worktree/container isolation | Not implemented |
| Provider-level concurrency | Not implemented |

### 3.3 Exit criteria

```bash
pnpm test:types
pnpm lint
```

All four developers should import shared types from a single contract module, such as `src/types/`, before deeper implementation begins.

---

## 4. Dev A Plan: CLI, Config, Parser, Validator

### 4.1 Scope

```text
src/cli/
src/config/
src/workflow/load.ts
src/workflow/parse.ts
src/workflow/validate.ts
src/errors/
```

### 4.2 Deliverables

#### CLI skeleton

Implement:

```bash
execflow run <workflow-file>
execflow validate <workflow-file>
execflow doctor
```

Supported MVP options:

```bash
--provider <codex|gemini|mock>
--arg key=value
--config <path>
--cwd <path>
--out <path>
--report <pretty|json|jsonl>
--concurrency <number>
--timeout-ms <number>
--dry-run
--fail-fast
--verbose
```

Reject or hide excluded MVP options:

```bash
--allow-shell
--isolation worktree
--isolation container
--retry
```

#### Config resolver

Implement:

- load `.execflow/config.yaml`
- merge CLI flags, agent options, config file, and built-in defaults
- validate `concurrency`, `timeoutMs`, provider names, report mode, `redactEnv`, and `passEnv`
- preserve rule that `--provider` sets only the default provider
- ensure explicit provider on an `agent()` call wins over CLI default provider

#### Workflow parser

Implement:

- read workflow source from disk
- preserve source for artifact storage
- extract `export const meta = { ... }`
- require metadata as the first top-level statement
- require `meta.name`
- require `meta.description`
- allow optional static `meta.phases`
- reject dynamic metadata

#### Workflow validator

Reject:

- `require()`
- arbitrary `import` statements
- direct filesystem access
- direct process access
- direct network APIs
- shell usage
- unsupported DSL calls such as `pipeline()`

#### Exit-code mapping

| Code | Meaning |
|---:|---|
| 0 | Success |
| 1 | Workflow failed |
| 2 | Invalid CLI usage |
| 3 | Workflow parse or validation error |
| 4 | Provider unavailable |
| 5 | Security policy violation |
| 6 | User cancelled |
| 7 | Timeout |
| 8 | Internal error |

### 4.3 Dependencies

Dev A depends only on the Phase 0 contracts. Runtime integration can initially be stubbed behind:

```ts
runWorkflow(parsedWorkflow, resolvedConfig, runtimeDeps)
```

### 4.4 Tests

- valid metadata passes
- missing metadata fails
- metadata not first statement fails
- dynamic metadata fails
- `require()` fails
- `import fs from "fs"` fails
- `process.env` fails
- `pipeline()` fails
- invalid config fails
- unknown provider fails clearly
- `run --dry-run` validates without invoking providers

---

## 5. Dev B Plan: Runtime, DSL, Scheduler

### 5.1 Scope

```text
src/workflow/runtime.ts
src/workflow/dsl.ts
src/workflow/sandbox.ts
src/orchestration/scheduler.ts
src/orchestration/state.ts
```

### 5.2 Deliverables

#### Runtime context

Implement a constrained workflow execution context that exposes only MVP capabilities:

```ts
agent(input: AgentCallInput): Promise<AgentResult>
parallel<T>(tasks: Record<string, () => Promise<T>> | Array<() => Promise<T>>): Promise<Record<string, T> | T[]>
phase(name: string): void
log(message: string, data?: unknown): void
```

Runtime should expose:

- `args`
- `cwd`
- `runId`
- `artifactsDir`

#### DSL behavior

- `phase(name)` emits `phase.started`
- `log(message, data?)` emits `workflow.log`
- `agent(input)` schedules one provider task through the scheduler
- `parallel(tasks)` accepts object or array task thunks
- `parallel(tasks)` waits for all branches to settle by default
- failed agents should return structured failure results rather than throwing from `parallel()` by default

#### Scheduler

Implement:

- global concurrency limiter
- queued task tracking
- running task tracking
- completion and failure tracking
- fail-fast behavior
- cancellation behavior
- drain behavior before workflow completion
- abort signal propagation to active provider executions

Lifecycle states:

```text
queued
preparing
running
validating
collecting_artifacts
succeeded
failed
timed_out
cancelled
skipped
```

#### Workflow result assembly

Runtime should:

- capture final default export or returned value
- include all agent results in the final `WorkflowRunResult`
- mark workflow failed when:
  - workflow parsing or validation fails
  - workflow code throws
  - runtime cannot safely continue
  - fail-fast aborts remaining work after an agent failure
  - final result generation fails

### 5.3 Dependencies

Dev B needs:

- event bus interface from Dev D
- provider execution interface from Dev C
- parsed workflow shape from Dev A

Dev B can begin immediately with fake event and provider implementations.

### 5.4 Tests

- single mock `agent()` succeeds
- `parallel()` returns object-shaped result
- `parallel()` returns array-shaped result
- concurrency limit is respected
- failed agent does not throw from `parallel()` by default
- fail-fast skips queued tasks
- fail-fast aborts running tasks where possible
- cancellation aborts running tasks
- scheduler drains before workflow completion
- workflow result includes all agent results

---

## 6. Dev C Plan: Process Runner, Providers, Schema Validation

### 6.1 Scope

```text
src/agents/
src/structured/
src/security/env.ts
```

### 6.2 Deliverables

#### Provider registry

Implement:

- register `mock`
- register `codex`
- register `gemini`
- resolve default provider
- produce clear error for unknown provider

#### Mock adapter

The mock adapter is mandatory for deterministic local and CI tests.

It should support configured behavior such as:

```yaml
providers:
  mock:
    responses:
      default:
        text: "mock response"
      review-auth:
        json:
          findings: []
      failure-case:
        error:
          message: "mock failure"
```

Mock adapter should support:

- text response
- JSON response
- configured failure
- configured delay
- timeout simulation

#### Process runner

Implement provider-agnostic process execution:

- spawn child process
- pass `stdin`
- stream stdout chunks
- stream stderr chunks
- enforce timeout
- support abort signal
- kill process tree where supported
- return exit code, signal, stdout, stderr, duration, timedOut, cancelled
- avoid printing unredacted environment values

#### Codex adapter

Implement:

- configurable `codex exec` command construction
- prompt via stdin when configured
- configured static args from config
- JSON output parsing when configured
- fallback text extraction
- raw stdout/stderr preservation

Conceptual command:

```bash
codex exec --json --ephemeral -
```

The exact command must remain configurable because provider CLI flags may change.

#### Gemini adapter

Implement:

- configurable `gemini -p` command construction
- configured output format
- configured model argument
- JSON output parsing when configured
- fallback text extraction
- raw stdout/stderr preservation

Conceptual command:

```bash
gemini -p "<prompt>" --output-format json
```

The exact command must remain configurable because provider CLI flags may change.

#### Structured output validation

For an agent call with a schema:

1. use provider parsed JSON if available
2. otherwise extract the first valid JSON object or block from stdout
3. validate locally against JSON Schema
4. return `AgentFailureResult` with `SCHEMA_VALIDATION_FAILED` when invalid
5. write validation error artifact

For an agent call without a schema:

1. prefer parsed provider text
2. fall back to stdout
3. preserve raw output artifacts regardless

No retry-on-validation-failure in MVP.

#### Doctor provider checks

Implement health checks:

- mock is always available
- Codex executable is discoverable
- Gemini executable is discoverable
- version/help checks where cheap and reliable
- missing providers produce clear messages

### 6.3 Dependencies

Dev C depends on:

- agent/result contracts from Phase 0
- artifact write hooks from Dev D
- scheduler calling convention from Dev B

Dev C can begin immediately with standalone fixture tests.

### 6.4 Tests

- mock text success
- mock JSON success
- mock configured failure
- mock configured delay
- process non-zero exit
- process timeout
- process abort
- Codex command construction
- Gemini command construction
- malformed JSON output
- schema validation success
- schema validation failure artifact
- `doctor` reports missing provider
- `doctor` reports available mock provider

---

## 7. Dev D Plan: Artifacts, Event Bus, Reporters, Integration Suite

### 7.1 Scope

```text
src/artifacts/
src/output/
src/orchestration/event-bus.ts
tests/integration/
tests/fixtures/
examples/
```

### 7.2 Deliverables

#### Artifact store

Create this run layout:

```text
.execflow/runs/<runId>/
  manifest.json
  workflow.input.ts
  config.resolved.json
  events.jsonl
  report.json
  agents/
    <agentId>/
      prompt.txt
      stdout.log
      stderr.log
      raw-result.json
      normalized-result.json
      schema.json
      validation-error.json
```

Durability requirements:

- create run directory before executing workflow code
- write `manifest.json` with `status: running` immediately
- append `events.jsonl` incrementally
- write per-agent logs incrementally
- write `report.json` using temp-file then atomic rename
- update manifest status at completion, failure, or cancellation
- preserve partial artifacts on failure

#### Event bus

Implement event envelopes with:

- `schemaVersion: "execflow.event.v1"`
- `runId`
- central monotonic `sequence`
- `timestamp`
- `type`
- `payload`

Required event types:

```text
workflow.started
workflow.completed
workflow.failed
workflow.cancelled
phase.started
phase.completed
workflow.log
agent.queued
agent.started
agent.output
agent.completed
agent.failed
agent.timed_out
agent.cancelled
```

Ordering rules:

- event bus assigns sequence numbers centrally
- sequence numbers are strictly increasing per run
- reporters receive events after the artifact store has accepted them for durable writing where feasible
- JSONL reporter outputs the same ordered event stream persisted to disk

#### Reporters

Implement:

- pretty terminal reporter for local use
- JSON final reporter for CI
- JSONL streaming reporter for CI and dashboards

Reporter behavior:

| Reporter | Intended use | Output behavior |
|---|---|---|
| `pretty` | Local terminal | Live human-readable status |
| `json` | CI final result | Final `WorkflowRunResult` JSON object only to stdout |
| `jsonl` | CI streaming | One event envelope per line to stdout |

Operational logs should go to stderr in JSON and JSONL modes.

#### Integration and golden tests

Provide:

- mock workflows
- golden `report.json`
- golden `events.jsonl`
- stdout cleanliness tests
- partial artifact tests
- failure-mode tests

### 7.3 Dependencies

Dev D depends only on the Phase 0 contracts at first. Runtime and provider integration can be simulated with synthetic events and synthetic reports.

### 7.4 Tests

- run directory is created
- manifest starts as `running`
- events append in order
- event sequence is strictly increasing
- final report is written atomically
- partial artifacts remain after failure
- JSON reporter emits valid JSON only
- JSONL reporter emits valid line-delimited JSON only
- pretty reporter displays phase and agent status
- golden report snapshots pass

---

## 8. Integration Checkpoints

### 8.1 Checkpoint 1: Mock Vertical Slice

Target command:

```bash
execflow run examples/mock-review.js --provider mock --report pretty
```

Must prove:

- CLI loads config
- workflow metadata validates
- runtime executes `phase`, `log`, `agent`, and `parallel`
- scheduler enforces global concurrency
- mock provider returns deterministic results
- artifacts are written
- pretty reporter displays progress

This is the first end-to-end milestone. It should happen before Codex and Gemini are considered complete.

---

### 8.2 Checkpoint 2: CI Reporting Slice

Target commands:

```bash
execflow run examples/mock-review.js --provider mock --report json > report.json
execflow run examples/mock-review.js --provider mock --report jsonl > events.jsonl
```

Must prove:

- JSON stdout contains only final report
- JSONL stdout contains only event envelopes
- persisted `report.json` matches final report contract
- event sequence is strictly increasing
- failed mock branch appears as structured failed result
- operational logs do not corrupt stdout in machine-readable modes

---

### 8.3 Checkpoint 3: Real Provider Adapters

Target commands:

```bash
execflow doctor
execflow run examples/codex-review.js --provider codex --report json
execflow run examples/gemini-review.js --provider gemini --report json
```

Must prove:

- `doctor` reports provider availability clearly
- missing provider maps to provider unavailable
- raw stdout and stderr are preserved
- Codex and Gemini both go through the same `AgentAdapter` path
- provider-specific parsing does not leak into workflow semantics

---

### 8.4 Checkpoint 4: Hardening and MVP Gate

The MVP acceptance suite must verify:

- `validate` catches invalid metadata
- `validate` catches restricted behavior
- `run` executes a valid workflow
- `agent()` can call mock, Codex, and Gemini providers
- `parallel()` obeys global concurrency
- failed agents return structured failure results
- timeouts terminate provider processes and preserve logs
- prompts, stdout, stderr, results, events, manifests, and reports are persisted
- pretty, JSON, and JSONL reporters work
- schema validation works and writes failure artifacts
- `doctor` detects missing provider CLIs
- documented exit codes are honored
- default test suite passes without real provider credentials

---

## 9. Suggested Task Board

### 9.1 Foundation

| Task | Owner | Blocks |
|---|---|---|
| Define shared contracts | All, led by Dev A | Everyone |
| Repo/package setup | Dev A | Everyone |
| Error and exit-code model | Dev A | CLI, runtime, providers |
| Event envelope contract | Dev D | Runtime, reporters |
| Agent result contract | Dev B + Dev C | Runtime, providers, reports |

### 9.2 Core execution

| Task | Owner | Blocks |
|---|---|---|
| Workflow loader/parser | Dev A | Runtime |
| Workflow validator | Dev A | Validate command, dry run |
| Runtime context | Dev B | End-to-end run |
| DSL functions | Dev B | Example workflows |
| Scheduler | Dev B | Parallel execution |
| Mock adapter | Dev C | Integration tests |
| Process runner | Dev C | Codex/Gemini adapters |
| Artifact store | Dev D | All durable outputs |
| Event bus | Dev D | Reporters, JSONL |

### 9.3 User-visible MVP

| Task | Owner | Blocks |
|---|---|---|
| `execflow run` | Dev A | MVP demo |
| `execflow validate` | Dev A | Authoring workflow |
| `execflow doctor` | Dev A + Dev C | Provider readiness |
| Pretty reporter | Dev D | Local developer experience |
| JSON reporter | Dev D | CI |
| JSONL reporter | Dev D | CI/event stream |
| JSON Schema validation | Dev C | Structured outputs |
| Codex adapter | Dev C | Real provider support |
| Gemini adapter | Dev C | Real provider support |
| Example workflows | Dev D + Dev B | Docs and demos |

---

## 10. Recommended Merge Order

1. Contracts and package skeleton
2. Artifact store and event bus
3. Parser, validator, and `execflow validate`
4. Runtime, scheduler, and mock adapter
5. Mock vertical slice
6. Reporters
7. Structured validation
8. Process runner
9. Codex and Gemini adapters
10. `execflow doctor`
11. Hardening, docs, examples, and golden tests

This order minimizes blocking. Dev A and Dev D create the CLI and observability backbone, Dev B builds runtime behavior against mock seams, and Dev C plugs in providers once process and agent contracts are stable.

---

## 11. MVP Definition of Done

The MVP is done when a developer can run:

```bash
execflow validate examples/parallel-review.js
execflow run examples/parallel-review.js --provider mock --concurrency 2 --report pretty
execflow run examples/parallel-review.js --provider mock --report json
execflow run examples/parallel-review.js --provider mock --report jsonl
execflow doctor
```

And each run reliably produces:

```text
.execflow/runs/<runId>/
  manifest.json
  workflow.input.ts
  config.resolved.json
  events.jsonl
  report.json
  agents/
    <agentId>/
      prompt.txt
      stdout.log
      stderr.log
      raw-result.json
      normalized-result.json
```

The implementation must provide:

- deterministic failures
- durable partial artifacts
- schema validation
- concurrency control
- timeout handling
- clean JSON and JSONL stdout modes
- documented exit codes
- passing tests without real Codex or Gemini credentials
