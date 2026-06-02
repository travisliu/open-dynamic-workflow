# execflow MVP Technical Design

**Product:** execflow  
**Document Type:** MVP Scope Technical Design  
**Status:** Draft  
**Date:** 2026-06-02  
**Audience:** Engineers, architects, AI tooling developers, DevOps/CI owners  
**Related inputs:** execflow PRD, execflow Architecture Design, principal-engineer architecture review

---

## 1. Summary

execflow MVP is a local-first CLI workflow runner for orchestrating external coding-agent CLIs. The MVP intentionally narrows the broader architecture to a reliable, testable, and observable core.

The MVP will support:

- Running constrained workflow files from the CLI.
- Calling coding-agent providers through `agent()`.
- Running independent agent calls concurrently through `parallel()`.
- Supporting initial providers: Codex, Gemini, and a required mock provider for tests.
- Capturing prompts, stdout, stderr, normalized results, events, and final reports as durable local artifacts.
- Enforcing global concurrency, timeouts, cancellation, schema validation, and deterministic exit codes.
- Producing human-readable terminal output and machine-readable JSON / JSONL output.

The MVP will not attempt to be a complete workflow platform, a full security sandbox, a distributed execution engine, or a patch-management system.

---

## 2. Design Goals

### 2.1 Primary Goals

1. **Reliable local orchestration**  
   Run multiple provider CLI invocations from a workflow file with predictable lifecycle behavior.

2. **Clear failure semantics**  
   Agent failures should be represented as structured results. Runtime/system failures should fail the workflow only when execution cannot safely continue.

3. **Strong observability**  
   Every run must produce durable artifacts, ordered events, raw logs, normalized results, and a final report.

4. **Provider isolation by contract**  
   Workflow semantics must not depend on Codex-specific or Gemini-specific stdout formats.

5. **Safe-by-default posture**  
   Shell access, shared writable modification, patch application, arbitrary environment exposure, and unbounded execution are out of scope or explicitly denied by default.

6. **Testability without real providers**  
   A mock provider is mandatory for deterministic unit, integration, and CI tests.

### 2.2 Non-Goals for MVP

The MVP explicitly excludes:

- `pipeline()`.
- Plugin provider system.
- Resumable runs.
- Distributed execution.
- Approval gates.
- Container isolation.
- Automatic patch application.
- True filesystem sandboxing.
- Worktree isolation as a default requirement.
- Provider-native stream-event interpretation as a required feature.
- Provider-level concurrency limits.
- Automatic cleanup and retention policies.
- Hosted dashboard or static HTML report.

Interfaces may leave room for these features, but implementation should not include them in the MVP unless required to complete the core behavior.

---

## 3. MVP Scope

### 3.1 Included CLI Commands

```bash
execflow run <workflow-file> [options]
execflow validate <workflow-file>
execflow doctor
```

Optional but low priority:

```bash
execflow init
```

### 3.2 Included `run` Options

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

### 3.3 Excluded `run` Options for MVP

These should be rejected with clear messages or hidden until implemented:

```bash
--allow-shell
--isolation worktree
--isolation container
--retry
```

The MVP may accept `--isolation none` and `--isolation copy` only if implemented simply and safely. Otherwise, isolation should be omitted from public MVP CLI flags.

---

## 4. Architecture Overview

The MVP architecture uses the following core components:

```text
execflow CLI
  ├─ Config Loader
  ├─ Workflow Loader
  ├─ Workflow Parser
  ├─ Workflow Validator
  ├─ Workflow Runtime
  ├─ Scheduler
  ├─ Agent Registry
  ├─ Provider Adapters
  │   ├─ Mock Adapter
  │   ├─ Codex Adapter
  │   └─ Gemini Adapter
  ├─ Process Runner
  ├─ Structured Output Validator
  ├─ Artifact Store
  ├─ Event Bus
  └─ Reporters
      ├─ Pretty Reporter
      ├─ JSON Reporter
      └─ JSONL Reporter
```

### 4.1 Key Boundary Rules

1. **Workflow runtime does not spawn processes directly.**  
   It calls the scheduler, which invokes provider adapters through controlled execution paths.

2. **Provider adapters do not own workflow policy.**  
   They construct provider commands and parse provider output. They do not decide workflow success/failure policy.

3. **Process runner is provider-agnostic.**  
   It spawns processes, streams logs, enforces timeouts, and handles abort signals.

4. **Structured validation is local and provider-independent.**  
   Provider-native structured output may be used, but execflow validates output locally.

5. **Reporters consume events; they do not control execution.**

6. **Artifact storage is central and always enabled.**

---

## 5. Execution Flow

```text
User runs execflow
  → Parse CLI flags
  → Load config
  → Resolve effective config
  → Load workflow source
  → Parse workflow metadata
  → Validate workflow restrictions
  → Create run artifact directory
  → Initialize event bus and reporters
  → Start workflow runtime
  → Execute workflow DSL
  → Schedule agent calls
  → Run provider CLI processes
  → Capture raw logs and outputs
  → Normalize provider result
  → Validate structured output when schema exists
  → Persist per-agent artifacts
  → Emit ordered events
  → Write final report atomically
  → Return documented exit code
```

---

## 6. Workflow DSL MVP

### 6.1 Supported DSL Functions

The MVP exposes only:

```ts
agent(input: AgentCallInput): Promise<AgentResult>
parallel<T>(tasks: Record<string, () => Promise<T>> | Array<() => Promise<T>>): Promise<Record<string, T> | T[]>
phase(name: string): void
log(message: string, data?: unknown): void
```

### 6.2 Recommended Workflow Shape

```ts
export const meta = {
  name: "parallel-review",
  description: "Review changed files with multiple coding-agent CLIs",
  phases: ["review", "summarize"]
};

phase("review");

const reviews = await parallel({
  codex: () => agent({
    id: "codex-review",
    provider: "codex",
    prompt: "Review the changed files for correctness issues."
  }),
  gemini: () => agent({
    id: "gemini-review",
    provider: "gemini",
    prompt: "Review the changed files for API design issues."
  })
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "codex",
  prompt: `Summarize these reviews:\n${JSON.stringify(reviews, null, 2)}`
});

export default {
  reviews,
  summary
};
```

### 6.3 Metadata Rules

The workflow file must begin with a statically analyzable metadata export:

```ts
export const meta = {
  name: "workflow-name",
  description: "workflow description"
};
```

Rules:

- `meta` must be the first top-level statement.
- `meta.name` is required.
- `meta.description` is required.
- `meta.phases` is optional.
- Dynamic expressions are rejected.

### 6.4 Rejected MVP Workflow Capabilities

The validator should reject:

- `require()`.
- Arbitrary `import` statements.
- Direct filesystem access.
- Direct process access.
- Shell execution.
- Network APIs from workflow code.
- Dynamic metadata.
- Unsupported DSL functions such as `pipeline()`.

---

## 7. Configuration Model

### 7.1 Config File

Default path:

```text
.execflow/config.yaml
```

Example:

```yaml
defaultProvider: codex
concurrency: 4
timeoutMs: 900000

providers:
  codex:
    command: codex
    args:
      - exec
      - --json
      - --ephemeral
    defaultModel: null

  gemini:
    command: gemini
    args:
      - --output-format
      - json
    defaultModel: gemini-2.5-flash

  mock:
    command: mock

security:
  passEnv: []
  redactEnv:
    - OPENAI_API_KEY
    - GEMINI_API_KEY
    - GOOGLE_API_KEY
    - '*_TOKEN'
    - '*_SECRET'
```

### 7.2 Precedence Rules

Use this precedence order:

1. CLI safety ceilings and hard overrides.
2. Explicit agent call options.
3. Workflow defaults, if introduced later.
4. Config file.
5. Built-in defaults.

Important distinction:

- `--provider codex` may set the default provider.
- It should not override an explicit `provider` inside an `agent()` call unless a future `--force-provider` flag is introduced.

---

## 8. Core Contracts

### 8.1 Agent Call Input

```ts
export interface AgentCallInput {
  id?: string;
  label?: string;
  provider?: "codex" | "gemini" | "mock" | string;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs?: number;
  cwd?: string;
  metadata?: Record<string, unknown>;
}
```

### 8.2 Agent Result

Use a discriminated union so workflow code and reports are unambiguous.

```ts
export type AgentResult = AgentSuccessResult | AgentFailureResult;

export interface AgentSuccessResult {
  ok: true;
  status: "succeeded";
  id: string;
  label?: string;
  provider: string;
  text?: string;
  json?: unknown;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  artifacts: AgentArtifacts;
}

export interface AgentFailureResult {
  ok: false;
  status: "failed" | "timed_out" | "cancelled" | "skipped";
  id: string;
  label?: string;
  provider: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  artifacts: AgentArtifacts;
  error: SerializedError;
}
```

### 8.3 Agent Artifacts

```ts
export interface AgentArtifacts {
  dir: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath?: string;
  normalizedResultPath?: string;
  schemaPath?: string;
  validationErrorPath?: string;
}
```

### 8.4 Workflow Run Result

```ts
export interface WorkflowRunResult {
  schemaVersion: "execflow.report.v1";
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  meta: WorkflowMeta;
  result?: unknown;
  agents: AgentResult[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  artifactsDir: string;
  reportPath: string;
  eventsPath: string;
  error?: SerializedError;
}
```

---

## 9. Event Model

### 9.1 Event Envelope

Every durable event must include a schema version and monotonic sequence number.

```ts
export interface EventEnvelope<TPayload> {
  schemaVersion: "execflow.event.v1";
  runId: string;
  sequence: number;
  timestamp: string;
  type: string;
  payload: TPayload;
}
```

### 9.2 Required Event Types

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

### 9.3 Ordering Rules

- The event bus assigns `sequence` numbers centrally.
- Sequence numbers are strictly increasing per run.
- Reporters receive events after the artifact store has accepted them for durable writing when feasible.
- JSONL reporter outputs the same ordered event stream persisted to disk.

---

## 10. Scheduler Design

### 10.1 Responsibilities

The scheduler owns agent lifecycle state.

It must:

- Enforce global concurrency.
- Queue tasks.
- Start tasks when capacity is available.
- Track pending, running, completed, failed, timed-out, and cancelled tasks.
- Respect `--fail-fast`.
- Drain scheduled tasks before workflow completion.
- Propagate cancellation to active process runs.

### 10.2 Agent Lifecycle States

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

### 10.3 Failure Behavior

Default behavior:

- An agent failure returns `AgentFailureResult`.
- `parallel()` waits for all branches to settle.
- The workflow may decide how to handle failed agent results.
- The final workflow status is failed if:
  - the workflow throws,
  - validation/parsing fails,
  - runtime cannot safely continue,
  - `--fail-fast` aborts remaining work after a failure,
  - or final result generation fails.

With `--fail-fast`:

- First failed/timed-out/cancelled agent causes queued tasks to be skipped.
- Running tasks receive abort signals.
- Final report includes partial results.

---

## 11. Provider Adapter Design

### 11.1 Adapter Responsibilities

Adapters should be small and provider-specific.

They are responsible for:

- Health checks for `doctor`.
- Building provider-specific command arguments.
- Declaring provider capabilities.
- Parsing raw stdout/stderr into a candidate normalized result.

They are not responsible for:

- Global workflow failure policy.
- Artifact directory creation.
- Redaction policy.
- Process timeout enforcement.
- Process cancellation.
- Final JSON Schema validation.

### 11.2 Adapter Interface

```ts
export interface AgentAdapter {
  name: string;

  checkHealth?(): Promise<ProviderHealth>;

  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;

  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}
```

### 11.3 Provider Command

```ts
export interface ProviderCommand {
  command: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env: Record<string, string>;
}
```

### 11.4 Provider Parsed Result

```ts
export interface ProviderParsedResult {
  text?: string;
  json?: unknown;
  raw?: unknown;
  parseWarnings?: string[];
}
```

### 11.5 Mock Adapter

The mock adapter is mandatory.

It should support deterministic behavior such as:

```yaml
providers:
  mock:
    responses:
      default:
        text: "mock response"
      review-auth:
        json:
          findings: []
```

Uses:

- Unit tests.
- Integration tests.
- Example workflows.
- CI validation without credentials.
- Dry-run-like local development.

### 11.6 Codex Adapter MVP

The Codex adapter should:

- Build a `codex exec` command.
- Prefer prompt via stdin when supported.
- Support configured static arguments from config.
- Capture raw stdout/stderr.
- Parse JSON output when configured.
- Fall back to text extraction.

Conceptual command:

```bash
codex exec --json --ephemeral -
```

The exact command must be configurable because provider CLI flags may change.

### 11.7 Gemini Adapter MVP

The Gemini adapter should:

- Build a `gemini -p` command.
- Support configured output format.
- Support configured model argument.
- Capture raw stdout/stderr.
- Parse JSON output when configured.
- Fall back to text extraction.

Conceptual command:

```bash
gemini -p "<prompt>" --output-format json
```

The exact command must be configurable because provider CLI flags may change.

---

## 12. Process Runner

### 12.1 Responsibilities

The process runner must:

- Spawn child processes.
- Stream stdout and stderr.
- Enforce timeout.
- Support abort signal.
- Kill process trees where supported.
- Return stdout, stderr, exit code, signal, and duration.
- Avoid printing unredacted environment values.

### 12.2 Interface

```ts
export interface ProcessRunInput {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ProcessRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}
```

---

## 13. Structured Output Validation

### 13.1 Normalization Order

For an agent call with a schema:

1. Use provider-native structured output if available.
2. Use provider JSON output if available.
3. Extract first valid JSON object/block from stdout.
4. If no valid JSON is available, return schema validation failure.

For an agent call without a schema:

1. Prefer parsed provider text.
2. Fall back to stdout.
3. Preserve raw output artifacts regardless.

### 13.2 Validation Failure

A validation failure should produce `AgentFailureResult` with:

- `status: "failed"`.
- `error.code: "SCHEMA_VALIDATION_FAILED"`.
- `validationErrorPath` artifact.
- Raw stdout/stderr artifacts preserved.

MVP should not implement retry-on-validation-failure.

---

## 14. Artifact Store

### 14.1 Run Directory Layout

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

### 14.2 Manifest

```ts
export interface RunManifest {
  schemaVersion: "execflow.manifest.v1";
  runId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  workflowPath: string;
  workflowHash: string;
  execflowVersion: string;
  cwd: string;
  configPath?: string;
}
```

### 14.3 Durability Rules

- Create run directory before executing workflow code.
- Write `manifest.json` with `status: running` immediately.
- Append `events.jsonl` incrementally.
- Write per-agent logs incrementally.
- Write `report.json` using temp-file then atomic rename.
- Update manifest status at completion/failure/cancellation.
- Preserve partial artifacts on failure.

---

## 15. Reporting

### 15.1 Pretty Reporter

Intended for local terminal use.

Minimum display:

```text
◇ parallel-review
  Phase: review

  ✓ codex-review       codex    18.3s
  ✕ gemini-review      gemini   failed

Artifacts:
  .execflow/runs/20260602-abc123
```

### 15.2 JSON Reporter

Prints only the final `WorkflowRunResult` JSON object to stdout.

Operational logs should go to stderr if needed.

### 15.3 JSONL Reporter

Streams ordered event envelopes to stdout.

The event stream should match persisted `events.jsonl`.

---

## 16. Security and Capability Policy

### 16.1 Security Positioning

The MVP must not claim to provide a complete sandbox.

A constrained JavaScript runtime reduces accidental misuse, but it does not fully secure execution against malicious workflows or provider CLIs. Provider CLIs may still access the filesystem, network, and credentials according to their own permissions.

### 16.2 MVP Defaults

```ts
export interface SecurityConfig {
  allowShell: false;
  allowWorkflowImports: false;
  passEnv: string[];
  redactEnv: string[];
}
```

Default behavior:

- Workflow shell execution is unavailable.
- Arbitrary imports are unavailable.
- Environment variables are not passed unless allowlisted.
- Known secret-like values are redacted from terminal output, events, reports, and persisted logs where feasible.
- Patches are never applied automatically.

### 16.3 Environment Filtering

Provider processes receive:

- Minimal process environment required to execute the provider CLI.
- Explicitly allowlisted variables from `security.passEnv`.
- Provider-specific required variables only when configured.

Secret redaction should match:

```text
*_KEY
*_TOKEN
*_SECRET
PASSWORD
OPENAI_API_KEY
GEMINI_API_KEY
GOOGLE_API_KEY
```

---

## 17. Error Handling and Exit Codes

### 17.1 Error Classes

```text
CLI_USAGE_ERROR
CONFIG_VALIDATION_ERROR
WORKFLOW_PARSE_ERROR
WORKFLOW_VALIDATION_ERROR
PROVIDER_UNAVAILABLE
PROVIDER_PROCESS_FAILED
PROCESS_TIMEOUT
SCHEMA_VALIDATION_FAILED
SECURITY_POLICY_VIOLATION
USER_CANCELLED
ARTIFACT_WRITE_FAILED
INTERNAL_ERROR
```

### 17.2 Exit Codes

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

### 17.3 Failure Mapping

- Workflow parse/validation failure → exit `3`.
- Missing provider CLI in `doctor` or run preflight → exit `4`.
- Any timed-out required agent causing workflow failure → exit `7`.
- User interrupt → exit `6`.
- Artifact write failure → exit `8` unless partial reporting is still possible.

---

## 18. Validation and Dry Run

### 18.1 `execflow validate`

Validates:

- Metadata location and static shape.
- Metadata required fields.
- Unsupported imports and restricted APIs.
- Basic syntax.
- Known DSL usage where statically detectable.

### 18.2 `execflow run --dry-run`

MVP dry run should:

- Parse workflow.
- Validate workflow.
- Resolve config.
- Print metadata and configured provider availability if known.
- Avoid invoking providers.

Because workflows are dynamic, dry run does not need to discover every possible agent call.

---

## 19. Testing Strategy

### 19.1 Unit Tests

Required coverage:

- Config loading and precedence.
- Metadata parsing.
- Workflow validation restrictions.
- Event sequencing.
- Artifact path generation.
- JSONL append behavior.
- Process runner timeout handling.
- Error serialization.
- Schema validation success/failure.
- Provider command construction.

### 19.2 Integration Tests

Use mock provider by default.

Required scenarios:

- Single successful agent call.
- Parallel agent calls with concurrency limit.
- Failed agent captured as result.
- `--fail-fast` cancels or skips remaining tasks.
- Timeout produces partial artifacts.
- Schema validation failure persists validation errors.
- JSON reporter emits valid final report.
- JSONL reporter emits ordered events.
- Pretty reporter does not corrupt JSON/JSONL output modes.

### 19.3 Adapter Fixture Tests

For Codex and Gemini:

- Command construction with configured args.
- Text output parsing.
- JSON output parsing.
- Malformed output handling.
- Non-zero exit handling.

Real provider E2E tests should be optional and credential-gated.

---

## 20. Implementation Plan

### Milestone 1: Contracts and Project Skeleton

Deliverables:

- Package setup.
- Type definitions for config, events, reports, agent results, errors.
- CLI command skeleton.
- Exit code mapping.

Acceptance criteria:

- `execflow --help` works.
- Types compile.
- Basic command routing exists.

### Milestone 2: Artifact Store and Event Bus

Deliverables:

- Run directory creation.
- Manifest writing.
- Event envelope with sequence numbers.
- JSONL event persistence.
- Atomic final report writing.

Acceptance criteria:

- A synthetic run can write manifest, events, and report.
- Crash-prone writes preserve partial events.

### Milestone 3: Workflow Parser and Validator

Deliverables:

- Metadata parser.
- Static metadata validation.
- Restricted syntax validation.
- `execflow validate`.

Acceptance criteria:

- Valid workflow passes.
- Dynamic metadata fails.
- Direct `require`, arbitrary import, filesystem, process, and shell usage fail.

### Milestone 4: Runtime, DSL, and Scheduler

Deliverables:

- Runtime context.
- `agent`, `parallel`, `phase`, `log`.
- Global concurrency limiter.
- Fail-fast behavior.
- Cancellation and drain semantics.

Acceptance criteria:

- Mock workflow with multiple agents runs.
- Concurrency limit is enforced.
- All agent results are available after `parallel()` settles.

### Milestone 5: Mock Provider and Process Runner

Deliverables:

- Mock adapter.
- Provider registry.
- Provider-independent process runner.
- Timeout handling.
- stdout/stderr streaming to artifacts.

Acceptance criteria:

- Tests run without Codex or Gemini installed.
- Timeout produces `timed_out` result and artifacts.

### Milestone 6: Reporters

Deliverables:

- Pretty reporter.
- JSON reporter.
- JSONL reporter.

Acceptance criteria:

- `--report pretty` renders human progress.
- `--report json` emits final JSON only to stdout.
- `--report jsonl` streams ordered events to stdout.

### Milestone 7: Structured Output Validation

Deliverables:

- JSON extraction.
- JSON Schema validation.
- Validation error artifacts.

Acceptance criteria:

- Valid schema output succeeds.
- Invalid schema output returns failed agent result with validation error artifact.

### Milestone 8: Codex and Gemini Adapters

Deliverables:

- Codex command builder and parser.
- Gemini command builder and parser.
- `execflow doctor` provider checks.
- Fixture tests.

Acceptance criteria:

- `doctor` clearly reports missing or available providers.
- Adapter tests do not require real credentials.
- Optional E2E tests can run with credentials.

---

## 21. Open Decisions Before Implementation

1. Should workflow files be executed as JavaScript only for MVP, with TypeScript support deferred?
2. Should `agent()` accept positional arguments, object arguments, or both? Recommendation: object-only for MVP.
3. Should `parallel()` accept arrays only, objects only, or both? Recommendation: support both, but prefer objects in examples for named results.
4. Should non-zero provider exit code always mean `AgentFailureResult`? Recommendation: yes, unless the adapter explicitly marks the provider output as usable and a future policy allows partial success.
5. Should `--provider` override explicit per-agent providers? Recommendation: no; add future `--force-provider` only if needed.
6. Should `copy` isolation be included in MVP? Recommendation: only if write-capable workflows are needed for launch; otherwise defer.

---

## 22. MVP Acceptance Criteria

The MVP is complete when:

1. `execflow validate workflow.ts` validates metadata and rejects restricted workflow behavior.
2. `execflow run workflow.ts` executes a valid workflow.
3. `agent()` can call mock, Codex, and Gemini providers through adapters.
4. `parallel()` runs multiple agent calls under a global concurrency limit.
5. Failed agents return structured failure results.
6. Timeouts terminate provider processes and preserve logs.
7. Prompts, stdout, stderr, normalized results, events, manifests, and final reports are persisted.
8. `--report pretty`, `--report json`, and `--report jsonl` work correctly.
9. JSON Schema validation works and failure artifacts are created.
10. `execflow doctor` detects missing provider CLIs.
11. Exit codes match the documented table.
12. The default test suite passes without real provider credentials.

---

## 23. Deferred Architecture Hooks

The MVP should leave clean extension points for later features without implementing them now.

Deferred feature | Extension point
---|---
Provider-level concurrency | Scheduler limiter hierarchy
Worktree isolation | Future isolation manager
Provider plugins | Agent registry
Retries | Scheduler policy layer
Approval gates | Runtime capability API
Patch collection | Artifact store agent directory
Resumable runs | Manifest and event log replay
Static HTML report | Final report and artifact reader
Container isolation | Isolation manager implementation

---

## 24. Final Recommendation

The MVP should optimize for correctness, durability, and debuggability rather than feature breadth.

The first implementation should be considered successful if it can reliably run deterministic mock workflows, produce trustworthy artifacts, capture all provider failures, and keep provider-specific behavior out of workflow semantics. Advanced workflow capabilities such as `pipeline()`, isolation modes, approval gates, retries, plugins, and resumability should wait until the core lifecycle model is proven stable.
