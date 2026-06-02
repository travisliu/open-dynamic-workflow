# execflow MVP — Developer B Detailed Implementation Plan

**Developer lane:** Developer B  
**Ownership:** Workflow runtime, DSL functions, scheduler, runtime cancellation, workflow result assembly  
**Audience:** Junior engineers implementing the MVP  
**Date:** 2026-06-02  
**Source inputs:** execflow PRD, Architecture Design, MVP Technical Design, four-developer implementation plan

---

## 1. Goal

Developer B is responsible for making a validated workflow actually run.

By the end of this lane, a user should be able to run a valid workflow that calls:

```ts
phase("review");
log("Starting review");

const results = await parallel({
  codex: () => agent({
    id: "codex-review",
    provider: "codex",
    prompt: "Review the changed files."
  }),
  gemini: () => agent({
    id: "gemini-review",
    provider: "gemini",
    prompt: "Review API design risks."
  })
});

export default { results };
```

Developer B does **not** implement command-line parsing, config loading, workflow metadata parsing, provider command construction, process spawning, artifact storage internals, or reporter rendering. Those are owned by Developers A, C, and D. Developer B owns the runtime orchestration layer between those pieces.

---

## 2. MVP Scope for Developer B

### 2.1 In scope

Developer B implements:

- Runtime entrypoint used by `execflow run`.
- Constrained workflow execution context.
- DSL injection for:
  - `agent(input)`
  - `parallel(tasks)`
  - `phase(name)`
  - `log(message, data?)`
- Scheduler with global concurrency control.
- Agent lifecycle state management.
- Fail-fast behavior.
- Cancellation and abort propagation.
- Scheduler drain semantics.
- Workflow result assembly.
- Runtime-level unit tests and integration tests using the mock provider seam.

### 2.2 Out of scope

Developer B must **not** implement these in MVP:

- `pipeline()`.
- Retry policy.
- Provider-level concurrency limits.
- Worktree isolation.
- Container isolation.
- Plugin provider system.
- Actual Codex or Gemini command construction.
- Child-process spawning.
- JSON Schema validation internals.
- Artifact file writing internals.
- Pretty/JSON/JSONL rendering internals.
- CLI option parsing.
- Static workflow parser or validator.

Developer B may define interfaces that leave room for future features, but should not implement excluded behavior.

---

## 3. Collaboration Contracts

Developer B sits in the middle of the system, so this lane must depend on stable interfaces instead of directly importing implementation details from other lanes.

### 3.1 Input from Developer A

Developer A provides parsed and validated workflow input.

```ts
export interface RuntimeRunInput {
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedExecflowConfig;
  cli: RunCliOptions;
}
```

Developer B should assume:

- metadata has already been parsed;
- static validation has already rejected disallowed APIs where possible;
- config has already been resolved;
- CLI options have already been validated.

Developer B should still fail safely if runtime execution sees an invalid DSL call.

### 3.2 Handoff to Developer C

Developer C owns provider execution. Developer B should call a provider execution interface, not process-runner or adapter implementations directly.

```ts
export interface AgentExecutor {
  execute(input: AgentExecutionInput): Promise<AgentResult>;
}
```

Recommended runtime-facing input:

```ts
export interface AgentExecutionInput {
  id: string;
  label?: string;
  provider: string;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs: number;
  cwd: string;
  metadata?: Record<string, unknown>;
  signal: AbortSignal;
}
```

### 3.3 Handoff to Developer D

Developer D owns event persistence, artifact storage, and reporters. Developer B should emit events and call artifact/report contracts, not write files directly.

```ts
export interface RuntimeEventSink {
  emit<TPayload>(type: string, payload: TPayload): Promise<void> | void;
}
```

Developer B should emit lifecycle events, but Developer D assigns durable sequence numbers and persists JSONL.

### 3.4 Runtime public contract

Developer B owns the main runtime implementation behind this public interface:

```ts
export interface RuntimeRunner {
  run(input: RuntimeRunInput, deps: RuntimeDependencies): Promise<WorkflowRunResult>;
}

export interface RuntimeDependencies {
  agentExecutor: AgentExecutor;
  eventSink: RuntimeEventSink;
  artifactStore?: RuntimeArtifactFacade;
  clock?: Clock;
  idGenerator?: IdGenerator;
}
```

`clock` and `idGenerator` should be injectable to make tests deterministic.

---

## 4. Implementation Order

Follow this order to avoid building too much at once.

1. Create runtime and scheduler type files.
2. Implement a simple event-emitting runtime shell.
3. Implement `phase()` and `log()` DSL functions.
4. Implement scheduler queue with global concurrency.
5. Implement `agent()` using scheduler and `AgentExecutor`.
6. Implement `parallel()` for arrays.
7. Implement `parallel()` for objects.
8. Implement workflow result assembly.
9. Implement runtime error handling.
10. Implement fail-fast behavior.
11. Implement cancellation and abort propagation.
12. Add deterministic tests with fake agent executor.
13. Integrate with Developer C mock provider and Developer D event/artifact store.

Keep each step small and covered by tests before moving to the next.

---

## 5. Files to Create or Edit

The paths below assume the planned TypeScript repository structure.

```text
execflow/
  src/
    runtime/
      public.ts
      runner.ts
      execute-module.ts
      result.ts
      errors.ts
      cancellation.ts
    workflow/
      runtime.ts
      dsl.ts
      sandbox.ts
      types.ts
    orchestration/
      scheduler.ts
      scheduler-types.ts
      task-state.ts
      cancellation.ts
      fail-fast.ts
    agents/
      execution-types.ts
    output/
      runtime-events.ts
    errors/
      runtime-errors.ts
      serialize.ts
  tests/
    unit/
      runtime/
        runtime-runner.test.ts
        dsl-agent.test.ts
        dsl-parallel-array.test.ts
        dsl-parallel-object.test.ts
        dsl-phase-log.test.ts
        workflow-result.test.ts
        runtime-errors.test.ts
        runtime-cancellation.test.ts
      orchestration/
        scheduler-concurrency.test.ts
        scheduler-fail-fast.test.ts
        scheduler-drain.test.ts
        scheduler-cancellation.test.ts
    fixtures/
      workflows/
        runtime-simple.js
        runtime-parallel-array.js
        runtime-parallel-object.js
        runtime-agent-failure.js
        runtime-throws.js
        runtime-invalid-agent-input.js
  examples/
    parallel-review.js
```

Some files may already exist from Developer A. Edit them carefully instead of duplicating types.

---

## 6. Detailed File Plan

## 6.1 `src/runtime/public.ts`

**Action:** Create or edit.  
**Purpose:** Export the runtime-facing public interfaces consumed by the CLI command.

### Required exports

```ts
export interface RuntimeRunner {
  run(input: RuntimeRunInput, deps: RuntimeDependencies): Promise<WorkflowRunResult>;
}

export interface RuntimeRunInput {
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedExecflowConfig;
  cli: RunCliOptions;
}

export interface RuntimeDependencies {
  agentExecutor: AgentExecutor;
  eventSink: RuntimeEventSink;
  artifactStore?: RuntimeArtifactFacade;
  clock?: Clock;
  idGenerator?: IdGenerator;
}
```

### Junior engineer notes

- This file should contain interfaces only or mostly interfaces.
- Avoid importing concrete classes such as `CodexAdapter`, `JsonReporter`, or `RunStore`.
- Public runtime code should be boring and stable. Other developers will import these types.

### Done when

- Dev A can call `runtimeRunner.run(...)` without importing scheduler internals.
- Unit tests can create fake dependencies easily.

---

## 6.2 `src/runtime/runner.ts`

**Action:** Create.  
**Purpose:** Main implementation of `RuntimeRunner`.

### Responsibilities

- Create a runtime context for one workflow run.
- Emit `workflow.started`.
- Execute workflow body with the DSL context.
- Wait for scheduler to drain.
- Assemble `WorkflowRunResult`.
- Emit `workflow.completed`, `workflow.failed`, or `workflow.cancelled`.
- Return the final `WorkflowRunResult`.

### Suggested structure

```ts
export class DefaultRuntimeRunner implements RuntimeRunner {
  async run(
    input: RuntimeRunInput,
    deps: RuntimeDependencies
  ): Promise<WorkflowRunResult> {
    const runtime = createRuntimeState(input, deps);

    await deps.eventSink.emit("workflow.started", {
      meta: input.parsedWorkflow.meta
    });

    try {
      const workflowResult = await executeWorkflowModule(runtime);
      await runtime.scheduler.drain();

      const result = buildSucceededRunResult(runtime, workflowResult);
      await deps.eventSink.emit("workflow.completed", resultToEventPayload(result));
      return result;
    } catch (error) {
      const result = buildFailedRunResult(runtime, error);
      await deps.eventSink.emit("workflow.failed", resultToEventPayload(result));
      return result;
    }
  }
}
```

### Important behavior

- Always try to return a `WorkflowRunResult`, even after failure.
- Preserve partial agent results collected before failure.
- Do not let a failed agent automatically throw unless fail-fast requires aborting.
- If workflow code throws, mark the workflow as failed.
- If user cancellation happens, mark the workflow as cancelled.

### Common mistakes to avoid

- Do not call provider adapters directly.
- Do not write event JSONL directly.
- Do not write `report.json` directly.
- Do not let unresolved scheduler tasks continue after returning.
- Do not swallow runtime errors without adding them to the final report.

### Done when

- A fake workflow with no agents can run and produce a successful `WorkflowRunResult`.
- A workflow that throws produces a failed `WorkflowRunResult`.
- A workflow with agent calls includes all agent results in the final report object.

---

## 6.3 `src/runtime/execute-module.ts`

**Action:** Create.  
**Purpose:** Execute the validated workflow source in a constrained context.

### Responsibilities

- Receive parsed workflow body from Developer A.
- Inject DSL functions into the execution context.
- Evaluate the workflow body.
- Return the workflow default export or final result.

### MVP execution approach

For MVP, use the simplest safe-enough mechanism agreed by the team. A common implementation is Node's `vm` module with a restricted context.

Example shape:

```ts
export async function executeWorkflowModule(
  runtime: RuntimeState
): Promise<unknown> {
  const dsl = createDsl(runtime);

  const context = createSandboxContext({
    agent: dsl.agent,
    parallel: dsl.parallel,
    phase: dsl.phase,
    log: dsl.log,
    args: runtime.args,
    cwd: runtime.cwd,
    runId: runtime.runId,
    artifactsDir: runtime.artifactsDir
  });

  return evaluateWorkflowBody(runtime.parsedWorkflow.body, context);
}
```

### Handling `export default`

Developer A may transform the workflow body before runtime receives it. Agree on one of these options:

1. Developer A removes `export const meta` and transforms `export default value` into `return value` or `__default = value`.
2. Developer B handles a small transform inside `execute-module.ts`.

Recommended: Developer A should produce runtime-ready body to keep this file focused.

### Junior engineer notes

- This is not a complete security sandbox. Do not claim it is.
- The validator blocks obvious bad code, but the runtime should expose only explicit capabilities.
- Do not pass Node globals such as `process`, `require`, `Buffer`, or filesystem APIs into the context.
- Include only what workflows need for MVP.

### Done when

- A simple workflow can use `phase`, `log`, `agent`, and `parallel`.
- Direct access to unavailable globals fails.
- The function returns the workflow's exported result.

---

## 6.4 `src/workflow/sandbox.ts`

**Action:** Create or edit.  
**Purpose:** Build the restricted runtime context used by workflow execution.

### Responsibilities

- Create a minimal global object for workflow execution.
- Inject only approved DSL functions and safe utility globals.
- Prevent direct access to Node APIs by omission.

### Allowed MVP globals

Recommended allowed globals:

```text
agent
parallel
phase
log
args
cwd
runId
artifactsDir
JSON
Array
Object
String
Number
Boolean
Promise
console? no, prefer log()
```

Use `log()` instead of exposing `console` if possible. If exposing `console` is necessary during early development, make it a wrapper that emits `workflow.log` and does not write directly to stdout.

### Disallowed MVP globals

Do not expose:

```text
require
import dynamic loading
process
fs
child_process
net
http
https
fetch
Buffer
setInterval
setTimeout, unless there is a clear timeout policy
Date, unless determinism rules allow it
Math.random, if static validation cannot block it
```

### Junior engineer notes

- A sandbox is the set of things workflow code can see.
- If you add something to the context, workflow authors can use it.
- Keep this file small and strict.

### Done when

- Workflow code can call the four MVP DSL functions.
- Workflow code cannot access Node process APIs through the provided context.

---

## 6.5 `src/workflow/dsl.ts`

**Action:** Create or edit.  
**Purpose:** Implement the workflow functions users call.

### Required functions

```ts
agent(input: AgentCallInput): Promise<AgentResult>
parallel<T>(tasks: Record<string, () => Promise<T>> | Array<() => Promise<T>>): Promise<Record<string, T> | T[]>
phase(name: string): void
log(message: string, data?: unknown): void
```

### `phase(name)` behavior

- Validate `name` is a non-empty string.
- Update current runtime phase.
- Emit `phase.started`.
- Optional: if a previous phase exists, emit `phase.completed` first.

Suggested implementation:

```ts
function phase(name: string): void {
  assertNonEmptyString(name, "phase name");
  runtime.currentPhase = name;
  runtime.eventSink.emit("phase.started", { phase: name });
}
```

### `log(message, data?)` behavior

- Validate `message` is a string.
- Emit `workflow.log`.
- Include `data` only if JSON-serializable.
- Do not print directly to stdout.

### `agent(input)` behavior

- Validate input object.
- Require `prompt`.
- Resolve provider using:
  1. `input.provider`
  2. default provider from config
- Resolve timeout using:
  1. `input.timeoutMs`
  2. global config timeout
- Resolve cwd using:
  1. `input.cwd`
  2. runtime cwd
- Generate stable agent ID if missing.
- Schedule the task through the scheduler.
- Return an `AgentResult`.

Suggested implementation shape:

```ts
async function agent(input: AgentCallInput): Promise<AgentResult> {
  const normalized = normalizeAgentCall(input, runtime);

  return runtime.scheduler.schedule({
    id: normalized.id,
    label: normalized.label,
    provider: normalized.provider,
    run: signal => runtime.agentExecutor.execute({
      ...normalized,
      signal
    })
  }, {
    provider: normalized.provider,
    timeoutMs: normalized.timeoutMs,
    failFast: runtime.config.failFast
  });
}
```

### `parallel(tasks)` behavior

- Accept an array of task thunks or an object of named task thunks.
- Validate every value is a function.
- Start all branches by calling their thunk.
- Let the scheduler enforce actual concurrency.
- Wait for all branches to settle unless fail-fast cancellation occurs.
- Preserve shape:
  - array input returns array output in same order
  - object input returns object output with same keys

Array example:

```ts
const results = await parallel([
  () => agent({ prompt: "A" }),
  () => agent({ prompt: "B" })
]);
```

Object example:

```ts
const results = await parallel({
  a: () => agent({ prompt: "A" }),
  b: () => agent({ prompt: "B" })
});
```

### Common mistakes to avoid

- Do not run provider commands in `agent()` directly.
- Do not implement your own concurrency inside `parallel()`; use the scheduler.
- Do not let one failed branch throw and lose other branch results by default.
- Do not reorder object keys.
- Do not return raw provider output instead of `AgentResult`.

### Done when

- Unit tests cover every DSL function.
- `parallel()` returns all results in the expected shape.
- Agent calls go through scheduler and fake executor in tests.

---

## 6.6 `src/workflow/types.ts`

**Action:** Create or edit.  
**Purpose:** Define workflow-level runtime types.

### Required types

```ts
export interface RuntimeState {
  runId: string;
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedExecflowConfig;
  args: Record<string, unknown>;
  cwd: string;
  artifactsDir: string;
  currentPhase?: string;
  startedAt: string;
  agentResults: AgentResult[];
  scheduler: Scheduler;
  agentExecutor: AgentExecutor;
  eventSink: RuntimeEventSink;
  abortController: AbortController;
}
```

You may split this into smaller files if it grows too large.

### Junior engineer notes

- Runtime state is for internal runtime coordination.
- Keep public report types separate from internal runtime state.
- Do not expose mutable runtime state directly to workflow code.

### Done when

- Runtime, DSL, and scheduler share consistent types.
- Tests can construct minimal runtime state fixtures.

---

## 6.7 `src/orchestration/scheduler-types.ts`

**Action:** Create.  
**Purpose:** Define scheduler interfaces and task types.

### Required exports

```ts
export interface Scheduler {
  schedule<T>(task: ScheduledTask<T>, options?: ScheduleOptions): Promise<T>;
  drain(): Promise<void>;
  abort(reason?: string): void;
  getSnapshot(): SchedulerSnapshot;
}

export interface ScheduledTask<T> {
  id: string;
  label?: string;
  provider?: string;
  run: (signal: AbortSignal) => Promise<T>;
}

export interface ScheduleOptions {
  provider?: string;
  timeoutMs?: number;
  failFast?: boolean;
}
```

### Notes

- Do not add provider-level concurrency yet.
- Do not add retries yet.
- Do not add priority unless needed for MVP.

### Done when

- Runtime can depend only on this interface.
- Tests can use the scheduler directly.

---

## 6.8 `src/orchestration/task-state.ts`

**Action:** Create.  
**Purpose:** Centralize task lifecycle states.

### Required state values

```ts
export type TaskState =
  | "queued"
  | "preparing"
  | "running"
  | "validating"
  | "collecting_artifacts"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "skipped";
```

### State transition guidance

Recommended normal path:

```text
queued -> preparing -> running -> succeeded
```

Failure path:

```text
queued -> preparing -> running -> failed
```

Timeout path:

```text
queued -> preparing -> running -> timed_out
```

Fail-fast skipped path:

```text
queued -> skipped
```

Cancellation path:

```text
queued -> skipped
running -> cancelled
```

### Junior engineer notes

- Keep state names stable because reporters and tests depend on them.
- Do not use many synonyms like `success`, `completed`, and `done` for the same concept.

### Done when

- Scheduler and events use consistent lifecycle vocabulary.

---

## 6.9 `src/orchestration/scheduler.ts`

**Action:** Create.  
**Purpose:** Implement global concurrency and task lifecycle management.

### Responsibilities

- Queue tasks when concurrency capacity is full.
- Start tasks when capacity is available.
- Track running tasks.
- Resolve each task's promise with its result.
- Reject only for scheduler/runtime errors, not normal agent failures.
- Support `drain()`.
- Support `abort()`.
- Support fail-fast.

### Suggested class structure

```ts
export class DefaultScheduler implements Scheduler {
  private readonly queue: InternalTask[] = [];
  private readonly running = new Map<string, InternalTask>();
  private readonly completed = new Map<string, TaskRecord>();
  private aborted = false;
  private abortReason?: string;

  constructor(private readonly options: SchedulerOptions) {}

  schedule<T>(task: ScheduledTask<T>, options?: ScheduleOptions): Promise<T> {
    // Add task to queue and pump.
  }

  drain(): Promise<void> {
    // Resolve when queue is empty and running size is zero.
  }

  abort(reason?: string): void {
    // Mark aborted, skip queued, abort running controllers.
  }

  private pump(): void {
    // Start queued tasks until running.size < concurrency.
  }
}
```

### Concurrency behavior

If `concurrency = 2` and four tasks are scheduled:

```text
Task A -> running
Task B -> running
Task C -> queued
Task D -> queued
```

When Task A completes:

```text
Task C -> running
```

### Fail-fast behavior

When `failFast = true` and one task fails or returns a failed agent result:

- mark queued tasks as skipped;
- abort running tasks;
- keep completed results;
- let `drain()` finish after all active tasks settle;
- final workflow result should include partial results.

### Detecting agent failure

A scheduled task may return an `AgentResult`. If the result has `ok: false`, scheduler should treat that as failure for fail-fast purposes.

```ts
function isFailedScheduledResult(value: unknown): boolean {
  return isAgentFailureResult(value);
}
```

### Timeout behavior

Timeout enforcement is owned by Developer C's process runner, but scheduler must pass `timeoutMs` and support abort signals.

The scheduler may also provide a safety timeout wrapper if the team decides that timeout ownership should be shared. If implemented, avoid double-reporting timeout events.

### Events emitted by scheduler/runtime

Emit these at appropriate points:

```text
agent.queued
agent.started
agent.completed
agent.failed
agent.timed_out
agent.cancelled
```

Developer D will persist and render them.

### Common mistakes to avoid

- Do not start all tasks immediately and then wait. That ignores concurrency.
- Do not forget to call `pump()` when a task completes.
- Do not leave `drain()` unresolved after all tasks finish.
- Do not throw away queued tasks during fail-fast without resolving their promises.
- Do not call event sink without task IDs.

### Done when

- Concurrency tests prove no more than N tasks run at once.
- Drain tests prove `drain()` resolves only after all tasks settle.
- Fail-fast tests prove queued tasks are skipped and running tasks are aborted.

---

## 6.10 `src/orchestration/cancellation.ts`

**Action:** Create.  
**Purpose:** Provide helper utilities for cancellation and abort signals.

### Responsibilities

- Create child `AbortController`s for scheduled tasks.
- Link parent runtime abort signal to task abort signals.
- Serialize cancellation reasons for reports.

### Suggested helpers

```ts
export function createLinkedAbortController(parent?: AbortSignal): AbortController;

export function isAbortError(error: unknown): boolean;

export function toCancellationError(reason?: string): SerializedError;
```

### Junior engineer notes

- `AbortSignal` is how runtime asks active provider work to stop.
- Cancelling a task does not always mean the process stopped instantly. It means we requested cancellation and then waited for it to settle.

### Done when

- Runtime cancellation test can abort a long fake agent task.
- Aborted task is marked `cancelled` or `skipped` depending on whether it started.

---

## 6.11 `src/orchestration/fail-fast.ts`

**Action:** Optional create.  
**Purpose:** Keep fail-fast result detection out of the main scheduler if needed.

### Responsibilities

- Detect whether a task result should trigger fail-fast.
- Normalize fail-fast reason messages.

### Suggested code

```ts
export function shouldTriggerFailFast(value: unknown, error?: unknown): boolean {
  if (error) return true;
  if (isAgentFailureResult(value)) return true;
  return false;
}
```

### Done when

- Scheduler fail-fast logic is easy to read.

---

## 6.12 `src/agents/execution-types.ts`

**Action:** Create or edit with Developer C.  
**Purpose:** Define the runtime-facing interface for executing one agent call.

### Required exports

```ts
export interface AgentExecutor {
  execute(input: AgentExecutionInput): Promise<AgentResult>;
}

export interface AgentExecutionInput {
  id: string;
  label?: string;
  provider: string;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs: number;
  cwd: string;
  metadata?: Record<string, unknown>;
  signal: AbortSignal;
}
```

### Junior engineer notes

- This is a seam. Dev B calls it; Dev C implements it.
- Do not import `CodexAdapter` or `GeminiAdapter` here.

### Done when

- Runtime can be tested with a fake `AgentExecutor`.
- Provider implementation can satisfy this interface later.

---

## 6.13 `src/output/runtime-events.ts`

**Action:** Create or edit with Developer D.  
**Purpose:** Define runtime event payloads emitted by Dev B code.

### Required event payloads

```ts
export interface WorkflowStartedPayload {
  meta: WorkflowMeta;
}

export interface PhaseStartedPayload {
  phase: string;
}

export interface WorkflowLogPayload {
  message: string;
  data?: unknown;
}

export interface AgentQueuedPayload {
  agentId: string;
  label?: string;
  provider: string;
}

export interface AgentStartedPayload {
  agentId: string;
  label?: string;
  provider: string;
  cwd: string;
}

export interface AgentCompletedPayload {
  agentId: string;
  label?: string;
  provider: string;
  status: string;
  durationMs: number;
  exitCode: number | null;
}
```

### Junior engineer notes

- Developer D wraps these in durable event envelopes.
- Keep payloads JSON-serializable.
- Do not put huge stdout content in every event unless the team explicitly wants streaming `agent.output` events.

### Done when

- Runtime and scheduler emit typed event payloads.
- Reporter tests can consume fake runtime events.

---

## 6.14 `src/runtime/result.ts`

**Action:** Create.  
**Purpose:** Build final `WorkflowRunResult` objects consistently.

### Responsibilities

- Build succeeded workflow result.
- Build failed workflow result.
- Build cancelled workflow result.
- Include all collected agent results.
- Include timing fields.
- Include artifact paths supplied by Developer D.
- Serialize runtime errors.

### Suggested functions

```ts
export function buildSucceededRunResult(input: BuildResultInput): WorkflowRunResult;

export function buildFailedRunResult(input: BuildResultInput & {
  error: unknown;
}): WorkflowRunResult;

export function buildCancelledRunResult(input: BuildResultInput & {
  reason?: string;
}): WorkflowRunResult;
```

### Result status rules

Use MVP statuses:

```ts
status: "succeeded" | "failed" | "cancelled"
```

Recommended mapping:

| Situation | Final workflow status |
|---|---|
| Workflow body completed and no runtime failure | `succeeded` |
| Workflow body throws | `failed` |
| Runtime cannot safely continue | `failed` |
| Fail-fast aborts remaining tasks | `failed` |
| User interrupt / external abort | `cancelled` |

Important: an individual failed agent does not automatically make the workflow failed unless the workflow throws, fail-fast is enabled, or team policy says final result must fail when any agent failed.

### Done when

- Result-building tests cover success, failure, cancellation, and partial agent results.

---

## 6.15 `src/runtime/errors.ts`

**Action:** Create.  
**Purpose:** Define runtime-specific error helpers.

### Required errors

```ts
RuntimeExecutionError
InvalidDslCallError
WorkflowCancelledError
SchedulerAbortedError
```

### Example

```ts
export class InvalidDslCallError extends Error {
  code = "INVALID_DSL_CALL";
}
```

### Junior engineer notes

- Use consistent `code` values so final reports and tests can assert them.
- Do not throw plain strings.
- Include actionable messages, for example: `agent() requires a prompt string`.

### Done when

- Invalid DSL calls produce clear runtime errors.
- Errors serialize into `WorkflowRunResult.error`.

---

## 6.16 `src/runtime/cancellation.ts`

**Action:** Create.  
**Purpose:** Handle runtime-level cancellation.

### Responsibilities

- Own the root `AbortController` for one workflow run.
- Connect CLI/user abort signal if Developer A provides one.
- Tell scheduler to abort when runtime is cancelled.
- Build cancelled final result when appropriate.

### Suggested behavior

```ts
export function attachRuntimeCancellation(
  runtime: RuntimeState,
  externalSignal?: AbortSignal
): void {
  if (!externalSignal) return;

  externalSignal.addEventListener("abort", () => {
    runtime.abortController.abort(externalSignal.reason);
    runtime.scheduler.abort("Runtime cancelled");
  });
}
```

### Done when

- Cancellation test proves running fake agent receives abort signal.
- Final report has `status: "cancelled"` for user abort.

---

## 6.17 `src/errors/runtime-errors.ts`

**Action:** Create or edit.  
**Purpose:** Register runtime error codes with the shared error system.

### Runtime error codes

```text
RUNTIME_EXECUTION_ERROR
INVALID_DSL_CALL
SCHEDULER_ABORTED
WORKFLOW_CANCELLED
INTERNAL_RUNTIME_ERROR
```

### Exit-code mapping expectations

Developer A owns final CLI exit-code mapping, but Developer B should set error codes clearly so mapping is possible.

| Runtime condition | Expected exit code |
|---|---:|
| Workflow code throws | 1 |
| Invalid DSL call at runtime | 1 or 3 depending on validation policy |
| Runtime cancelled | 6 |
| Internal runtime bug | 8 |

### Done when

- Runtime errors serialize with `name`, `message`, and `code`.

---

## 7. Runtime Behavior Details

## 7.1 `agent()` lifecycle

For each agent call, the runtime should do this:

```text
workflow calls agent(input)
  → validate input
  → normalize id/provider/cwd/timeout
  → emit agent.queued
  → scheduler queues task
  → scheduler starts task when concurrency allows
  → emit agent.started
  → AgentExecutor.execute(...) runs provider layer
  → collect AgentResult
  → store AgentResult in runtime.agentResults
  → emit agent.completed / agent.failed / agent.timed_out / agent.cancelled
  → return AgentResult to workflow code
```

### Required input validation

`agent()` should reject:

- missing input object;
- missing `prompt`;
- non-string `prompt`;
- empty prompt;
- invalid `id` if provided;
- invalid `provider` if provided;
- invalid timeout if provided.

Error messages should be written for users, not just developers.

Good:

```text
agent() requires a non-empty prompt string.
```

Bad:

```text
Cannot read properties of undefined.
```

---

## 7.2 `parallel()` lifecycle

For array input:

```text
parallel([
  task0,
  task1,
  task2
])
  → validate all entries are functions
  → call all task functions to schedule their work
  → wait for all promises to settle
  → return [result0, result1, result2]
```

For object input:

```text
parallel({
  a: taskA,
  b: taskB
})
  → validate all values are functions
  → call all task functions to schedule their work
  → wait for all promises to settle
  → return { a: resultA, b: resultB }
```

### Failure behavior

Default:

- individual failed agents return `AgentFailureResult`;
- `parallel()` returns results for all branches;
- workflow code can inspect `result.ok`.

If a branch throws a runtime error not represented as `AgentFailureResult`:

- capture it as a failed branch result if possible;
- otherwise let the workflow fail clearly.

With fail-fast:

- first failure aborts remaining work;
- final workflow result should include partial results;
- queued tasks should be marked skipped;
- running tasks should receive abort signals.

---

## 7.3 Scheduler lifecycle events

The scheduler/runtime should produce event payloads around state changes.

Minimum event sequence for one successful agent:

```text
agent.queued
agent.started
agent.completed
```

For failed agent:

```text
agent.queued
agent.started
agent.failed
```

For timed-out agent:

```text
agent.queued
agent.started
agent.timed_out
```

For skipped queued task under fail-fast:

```text
agent.queued
agent.cancelled or agent.skipped
```

Use exactly the event type names agreed with Developer D. If `agent.skipped` is not in the MVP event list, represent skipped work as `agent.cancelled` with `status: "skipped"` in the payload.

---

## 7.4 Workflow success and failure policy

The MVP technical design says agent failures should be represented as structured results. Runtime/system failures should fail the workflow when execution cannot safely continue.

Recommended rules:

### Workflow succeeds when

- workflow code completes;
- scheduler drains;
- final result can be assembled;
- no fail-fast abort occurred.

This can be true even if one `AgentResult` has `ok: false`, because the workflow may intentionally handle failed agent results.

### Workflow fails when

- workflow code throws;
- invalid DSL call occurs;
- scheduler has an internal error;
- fail-fast aborts the workflow;
- final result assembly fails.

### Workflow is cancelled when

- external abort/user interrupt happens;
- runtime root signal is aborted before normal completion.

---

## 8. Junior Engineer Implementation Guidance

## 8.1 Start with fake dependencies

Do not wait for Codex, Gemini, artifacts, or reporters.

Create a fake agent executor for tests:

```ts
class FakeAgentExecutor implements AgentExecutor {
  active = 0;
  maxActive = 0;

  async execute(input: AgentExecutionInput): Promise<AgentResult> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);

    try {
      await sleep(10, input.signal);
      return makeAgentSuccess({ id: input.id, provider: input.provider });
    } finally {
      this.active -= 1;
    }
  }
}
```

This lets you test runtime and scheduler before provider code exists.

## 8.2 Keep concurrency in one place

Only the scheduler should enforce global concurrency.

Bad:

```ts
// Do not add ad-hoc batching in parallel().
for (const batch of chunks(tasks, concurrency)) {
  await Promise.all(batch.map(task => task()));
}
```

Good:

```ts
// parallel() starts branches. Scheduler decides when each agent actually runs.
await Promise.all(tasks.map(task => task()));
```

## 8.3 Preserve shape in `parallel()`

Users expect object input to return object output.

Input:

```ts
await parallel({
  review: () => agent(...),
  summarize: () => agent(...)
});
```

Output:

```ts
{
  review: AgentResult,
  summarize: AgentResult
}
```

## 8.4 Be careful with thrown errors

Agent failures are usually values, not exceptions.

```ts
if (!result.ok) {
  // This is a valid result object.
  // Do not automatically throw unless fail-fast says to abort.
}
```

Throw only for runtime failures such as invalid DSL usage or scheduler bugs.

## 8.5 Emit events consistently

Every event should include enough information for Developer D to render useful output:

- run ID is added by event bus, but payload should include task/phase information;
- agent events need `agentId`, `provider`, and optional `label`;
- completion events need status and duration if available.

## 8.6 Make tests deterministic

Avoid real time and random IDs in tests.

Use injected dependencies:

```ts
const clock = new FakeClock("2026-06-02T00:00:00.000Z");
const idGenerator = new IncrementingIdGenerator("agent");
```

---

## 9. Testing Plan

## 9.1 Unit tests for runtime runner

File:

```text
tests/unit/runtime/runtime-runner.test.ts
```

Test cases:

1. workflow without agents succeeds;
2. workflow with one agent succeeds;
3. workflow with multiple agents includes all agent results;
4. workflow that throws returns failed `WorkflowRunResult`;
5. workflow cancellation returns cancelled `WorkflowRunResult`;
6. runtime emits `workflow.started` and `workflow.completed`;
7. failed workflow emits `workflow.failed`.

---

## 9.2 Unit tests for `phase()` and `log()`

File:

```text
tests/unit/runtime/dsl-phase-log.test.ts
```

Test cases:

1. `phase("review")` updates current phase;
2. `phase("review")` emits `phase.started`;
3. empty phase name throws `InvalidDslCallError`;
4. `log("hello")` emits `workflow.log`;
5. `log("hello", { count: 1 })` preserves data.

---

## 9.3 Unit tests for `agent()`

File:

```text
tests/unit/runtime/dsl-agent.test.ts
```

Test cases:

1. valid agent call schedules a task;
2. missing prompt throws clear error;
3. default provider is used when input provider missing;
4. explicit provider overrides default provider;
5. timeout is resolved from input when provided;
6. timeout falls back to config;
7. generated ID is used when missing;
8. returned result is added to `runtime.agentResults`;
9. failed agent result is returned as value.

---

## 9.4 Unit tests for `parallel()` array input

File:

```text
tests/unit/runtime/dsl-parallel-array.test.ts
```

Test cases:

1. array tasks run and return array results;
2. result order matches input order;
3. non-function array item throws clear error;
4. failed agent result appears in result array;
5. branch runtime error is handled according to agreed policy.

---

## 9.5 Unit tests for `parallel()` object input

File:

```text
tests/unit/runtime/dsl-parallel-object.test.ts
```

Test cases:

1. object tasks run and return object results;
2. output keys match input keys;
3. non-function object value throws clear error;
4. failed agent result appears under correct key;
5. all branches are awaited before return.

---

## 9.6 Unit tests for scheduler concurrency

File:

```text
tests/unit/orchestration/scheduler-concurrency.test.ts
```

Test cases:

1. concurrency `1` runs tasks one at a time;
2. concurrency `2` never exceeds two active tasks;
3. tasks start in queued order;
4. queued tasks start when running task completes;
5. `drain()` waits for queued and running tasks.

---

## 9.7 Unit tests for scheduler fail-fast

File:

```text
tests/unit/orchestration/scheduler-fail-fast.test.ts
```

Test cases:

1. with fail-fast off, one failed result does not abort others;
2. with fail-fast on, failed result aborts running tasks;
3. with fail-fast on, failed result skips queued tasks;
4. partial results are preserved;
5. fail-fast reason is available in scheduler snapshot.

---

## 9.8 Unit tests for scheduler cancellation

File:

```text
tests/unit/orchestration/scheduler-cancellation.test.ts
```

Test cases:

1. abort before start marks queued task skipped;
2. abort while running sends signal to task;
3. cancelled running task resolves or rejects predictably;
4. `drain()` completes after cancellation settles;
5. no task remains running after abort.

---

## 9.9 Runtime fixture workflows

Create fixture workflows for integration-like tests.

### `tests/fixtures/workflows/runtime-simple.js`

```js
export const meta = {
  name: "runtime-simple",
  description: "Simple runtime test"
};

phase("start");
log("hello");

export default { ok: true };
```

### `tests/fixtures/workflows/runtime-parallel-object.js`

```js
export const meta = {
  name: "runtime-parallel-object",
  description: "Parallel object test"
};

phase("review");

const results = await parallel({
  a: () => agent({ id: "a", provider: "mock", prompt: "A" }),
  b: () => agent({ id: "b", provider: "mock", prompt: "B" })
});

export default { results };
```

### `tests/fixtures/workflows/runtime-agent-failure.js`

```js
export const meta = {
  name: "runtime-agent-failure",
  description: "Agent failure is represented as result"
};

const result = await agent({
  id: "expected-failure",
  provider: "mock",
  prompt: "Return a configured failure"
});

export default { result };
```

---

## 10. Acceptance Criteria for Developer B

Developer B's lane is complete when all of these are true:

1. `RuntimeRunner.run()` executes a parsed workflow body.
2. Runtime exposes only MVP DSL functions.
3. `phase()` emits phase events and updates runtime state.
4. `log()` emits workflow log events.
5. `agent()` validates input, resolves defaults, and schedules work.
6. `parallel()` supports array input.
7. `parallel()` supports object input.
8. Global concurrency limit is enforced by the scheduler.
9. `parallel()` waits for all branches to settle by default.
10. Failed agents return structured `AgentFailureResult` values.
11. Fail-fast aborts running tasks and skips queued tasks.
12. Runtime cancellation propagates to scheduled tasks through `AbortSignal`.
13. Scheduler `drain()` waits for all queued/running work to settle.
14. Final `WorkflowRunResult` includes all collected agent results.
15. Workflow throws produce failed run results.
16. User/runtime cancellation produces cancelled run results.
17. Unit tests pass with a fake agent executor.
18. Integration with Developer C's mock provider works.
19. Integration with Developer D's event sink and artifact/report path data works.

---

## 11. Suggested Pull Request Breakdown

Keep PRs small enough for review.

### PR B1 — Runtime and scheduler contracts

Includes:

- `src/runtime/public.ts`
- `src/workflow/types.ts`
- `src/orchestration/scheduler-types.ts`
- `src/orchestration/task-state.ts`
- fake test helpers

Acceptance:

- types compile;
- no concrete provider/reporting dependencies.

### PR B2 — Basic runtime runner with phase/log

Includes:

- `src/runtime/runner.ts`
- `src/runtime/execute-module.ts`
- `src/workflow/sandbox.ts`
- `src/workflow/dsl.ts` with `phase` and `log`

Acceptance:

- simple workflow runs;
- phase/log events emitted.

### PR B3 — Scheduler concurrency

Includes:

- `src/orchestration/scheduler.ts`
- scheduler tests

Acceptance:

- concurrency is enforced;
- drain works.

### PR B4 — `agent()` DSL integration

Includes:

- `agent()` implementation
- fake `AgentExecutor`
- agent DSL tests

Acceptance:

- agent call schedules task;
- result is returned and collected.

### PR B5 — `parallel()` DSL integration

Includes:

- array/object `parallel()` implementation
- parallel tests

Acceptance:

- results preserve input shape;
- failures are returned as values.

### PR B6 — Fail-fast and cancellation

Includes:

- cancellation helpers
- fail-fast behavior
- cancellation tests

Acceptance:

- queued tasks skipped;
- running tasks aborted;
- partial results preserved.

### PR B7 — Workflow result assembly and integration hardening

Includes:

- `src/runtime/result.ts`
- runtime result tests
- integration with Dev C/D interfaces

Acceptance:

- final `WorkflowRunResult` is correct for success, failure, and cancellation.

---

## 12. Integration Checklist With Other Developers

### With Developer A

Confirm:

- exact shape of `ParsedWorkflow.body`;
- whether `export default` is transformed by parser or runtime;
- `RunCliOptions` shape;
- `ResolvedExecflowConfig` shape;
- how CLI passes external abort/user interrupt signal;
- how `--dry-run` bypasses runtime.

### With Developer C

Confirm:

- `AgentExecutor.execute()` signature;
- timeout responsibility boundary;
- how cancelled provider executions return `AgentResult`;
- how failed provider executions represent `ok: false`;
- how mock provider simulates delay, failure, and timeout.

### With Developer D

Confirm:

- event type names;
- event payload shapes;
- whether event emission is sync or async;
- whether runtime should await event sink writes;
- how final report path and artifacts directory are supplied to result builder;
- whether scheduler emits events directly or runtime wraps scheduler events.

---

## 13. Example End-to-End Behavior

Given this workflow:

```js
export const meta = {
  name: "parallel-review",
  description: "Review with two agents",
  phases: ["review", "summarize"]
};

phase("review");

const reviews = await parallel({
  codex: () => agent({
    id: "codex-review",
    provider: "mock",
    prompt: "Review correctness."
  }),
  gemini: () => agent({
    id: "gemini-review",
    provider: "mock",
    prompt: "Review API design."
  })
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "mock",
  prompt: `Summarize: ${JSON.stringify(reviews)}`
});

export default { reviews, summary };
```

Runtime should produce behavior similar to:

```text
workflow.started
phase.started review
agent.queued codex-review
agent.queued gemini-review
agent.started codex-review
agent.started gemini-review
agent.completed codex-review
agent.completed gemini-review
phase.started summarize
agent.queued summary
agent.started summary
agent.completed summary
workflow.completed
```

Final result should include:

```json
{
  "schemaVersion": "execflow.report.v1",
  "status": "succeeded",
  "meta": {
    "name": "parallel-review",
    "description": "Review with two agents"
  },
  "result": {
    "reviews": {
      "codex": { "ok": true },
      "gemini": { "ok": true }
    },
    "summary": { "ok": true }
  },
  "agents": [
    { "id": "codex-review", "ok": true },
    { "id": "gemini-review", "ok": true },
    { "id": "summary", "ok": true }
  ]
}
```

---

## 14. Definition of Done

Developer B is done when this command works after integration:

```bash
execflow run examples/parallel-review.js --provider mock --concurrency 2 --report pretty
```

And all of the following are true:

- workflows execute in constrained runtime context;
- only `agent`, `parallel`, `phase`, and `log` are exposed as MVP DSL functions;
- scheduler enforces global concurrency;
- agent results are returned to workflow code;
- parallel object/array results preserve shape;
- fail-fast and cancellation behavior are covered by tests;
- runtime emits lifecycle events;
- final `WorkflowRunResult` contains workflow result and all agent results;
- no real provider credentials are required for Developer B tests.

