# execflow MVP — Developer D Detailed Implementation Plan

**Developer:** Developer D  
**Area:** Artifacts, Event Bus, Reporters, Integration Tests  
**Audience:** Junior engineers  
**Date:** 2026-06-02  
**Source inputs:** execflow PRD, execflow Architecture Design, execflow MVP Technical Design

---

## 1. What Developer D Owns

Developer D owns the parts of execflow that make a workflow run observable, durable, reportable, and testable.

You are responsible for these MVP components:

1. Artifact Store
2. Run Manifest
3. Event Bus
4. Event Contracts
5. Pretty Reporter
6. JSON Reporter
7. JSONL Reporter
8. Integration Test Fixtures
9. Golden Output Tests
10. Example Workflows for mock-provider testing

Your work is the backbone for debugging. Even when an agent fails, times out, or is cancelled, execflow must still preserve enough information for a developer or CI system to understand what happened.

---

## 2. MVP Requirements You Must Satisfy

The MVP requires every run to preserve:

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

The MVP also requires:

- ordered durable event envelopes
- monotonic sequence numbers
- final JSON reports
- streaming JSONL events
- human-readable pretty output
- atomic final report writing
- partial artifacts preserved after failures
- clean stdout behavior for JSON and JSONL modes
- integration tests using the mock provider by default

---

## 3. Files Developer D Should Create or Edit

### Primary files

```text
src/artifacts/run-store.ts
src/artifacts/manifest.ts
src/artifacts/logs.ts
src/orchestration/event-bus.ts
src/output/events.ts
src/output/reporter.ts
src/output/pretty-reporter.ts
src/output/json-reporter.ts
src/output/jsonl-reporter.ts
```

### Test files

```text
tests/unit/artifacts/run-store.test.ts
tests/unit/artifacts/manifest.test.ts
tests/unit/orchestration/event-bus.test.ts
tests/unit/output/pretty-reporter.test.ts
tests/unit/output/json-reporter.test.ts
tests/unit/output/jsonl-reporter.test.ts
tests/integration/mock-run-success.test.ts
tests/integration/mock-run-failure.test.ts
tests/integration/mock-run-json.test.ts
tests/integration/mock-run-jsonl.test.ts
tests/integration/mock-run-artifacts.test.ts
```

### Fixture and example files

```text
tests/fixtures/workflows/mock-success.workflow.js
tests/fixtures/workflows/mock-failure.workflow.js
tests/fixtures/workflows/mock-schema-failure.workflow.js
tests/fixtures/config/mock.config.yaml
tests/fixtures/golden/success-report.json
tests/fixtures/golden/success-events.jsonl
examples/mock-review.js
```

### Shared contract files you may need to edit with the team

These files may be owned by Dev A or shared by all developers. Do not change them without coordinating.

```text
src/types/events.ts
src/types/reports.ts
src/types/artifacts.ts
src/types/errors.ts
src/types/config.ts
src/index.ts
```

If the project does not use `src/types/`, place the shared contracts near the related module, but keep the exports stable.

---

## 4. Implementation Order

Build in this order to avoid blocking yourself:

1. Define event and artifact types.
2. Implement the run manifest helpers.
3. Implement the artifact store.
4. Implement the event bus.
5. Implement the reporter interface.
6. Implement JSONL reporter.
7. Implement JSON reporter.
8. Implement pretty reporter.
9. Add unit tests.
10. Add integration fixtures.
11. Add integration tests.
12. Connect your modules to Dev A's CLI and Dev B's runtime.

The reason JSONL comes before pretty output is that JSONL is easier to test and is directly tied to durable event ordering.

---

# Part 1: Shared Types

## 5. File: `src/output/events.ts`

### Purpose

Define the event envelope and event type helpers used by the event bus, reporters, runtime, scheduler, and tests.

### What to implement

```ts
export type EventType =
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.cancelled"
  | "phase.started"
  | "phase.completed"
  | "workflow.log"
  | "agent.queued"
  | "agent.started"
  | "agent.output"
  | "agent.completed"
  | "agent.failed"
  | "agent.timed_out"
  | "agent.cancelled";

export interface EventEnvelope<TPayload = unknown> {
  schemaVersion: "execflow.event.v1";
  runId: string;
  sequence: number;
  timestamp: string;
  type: EventType;
  payload: TPayload;
}
```

### Payload types to add

Add these interfaces so other developers get useful autocomplete:

```ts
export interface WorkflowStartedPayload {
  meta: {
    name: string;
    description: string;
    phases?: string[];
  };
  workflowPath: string;
  artifactsDir: string;
}

export interface WorkflowCompletedPayload {
  status: "succeeded";
  durationMs: number;
}

export interface WorkflowFailedPayload {
  status: "failed";
  durationMs: number;
  error: SerializedError;
}

export interface WorkflowCancelledPayload {
  status: "cancelled";
  durationMs: number;
  reason?: string;
}

export interface PhaseStartedPayload {
  name: string;
}

export interface PhaseCompletedPayload {
  name: string;
  durationMs?: number;
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

export interface AgentOutputPayload {
  agentId: string;
  stream: "stdout" | "stderr";
  data: string;
}

export interface AgentCompletedPayload {
  agentId: string;
  label?: string;
  provider: string;
  status: "succeeded";
  durationMs: number;
  exitCode: number;
  artifacts: AgentArtifacts;
}

export interface AgentFailedPayload {
  agentId: string;
  label?: string;
  provider: string;
  status: "failed";
  durationMs: number;
  exitCode: number | null;
  error: SerializedError;
  artifacts: AgentArtifacts;
}

export interface AgentTimedOutPayload {
  agentId: string;
  label?: string;
  provider: string;
  status: "timed_out";
  durationMs: number;
  error: SerializedError;
  artifacts: AgentArtifacts;
}

export interface AgentCancelledPayload {
  agentId: string;
  label?: string;
  provider: string;
  status: "cancelled";
  durationMs: number;
  error?: SerializedError;
  artifacts?: AgentArtifacts;
}
```

If `SerializedError` or `AgentArtifacts` do not exist yet, import them from the shared types file after Dev A or Dev C creates them. Until then, define temporary local versions and replace them during integration.

### Junior engineer notes

- Do not put business logic in this file.
- This file should contain types and small helper functions only.
- Keep event names exactly as listed. Tests will compare strings.
- Do not rename `schemaVersion`.

### Suggested helper

```ts
export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as EventEnvelope).schemaVersion === "execflow.event.v1" &&
      typeof (value as EventEnvelope).runId === "string" &&
      typeof (value as EventEnvelope).sequence === "number" &&
      typeof (value as EventEnvelope).timestamp === "string" &&
      typeof (value as EventEnvelope).type === "string"
  );
}
```

---

# Part 2: Artifact Store

## 6. File: `src/artifacts/manifest.ts`

### Purpose

Create and update the run manifest file.

The manifest is the first durable record that a run exists. It starts with `status: "running"` and is updated to `succeeded`, `failed`, or `cancelled` at the end.

### Types to implement

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

export interface CreateManifestInput {
  runId: string;
  workflowPath: string;
  workflowHash: string;
  execflowVersion: string;
  cwd: string;
  configPath?: string;
  now?: Date;
}
```

### Functions to implement

```ts
export function createInitialManifest(input: CreateManifestInput): RunManifest;

export function updateManifestStatus(
  manifest: RunManifest,
  status: "succeeded" | "failed" | "cancelled",
  now?: Date
): RunManifest;
```

### Implementation details

- Use `new Date().toISOString()` for timestamps.
- `createdAt` should not change after creation.
- `updatedAt` should change every time the manifest status changes.
- The manifest should be serializable with `JSON.stringify(manifest, null, 2)`.

### Unit tests

Create `tests/unit/artifacts/manifest.test.ts`.

Test cases:

1. `createInitialManifest` returns `status: "running"`.
2. `schemaVersion` is exactly `execflow.manifest.v1`.
3. `createdAt` and `updatedAt` are ISO strings.
4. `updateManifestStatus` preserves `createdAt`.
5. `updateManifestStatus` changes `updatedAt`.
6. `updateManifestStatus` sets the requested final status.

---

## 7. File: `src/artifacts/run-store.ts`

### Purpose

Own all filesystem writes under `.execflow/runs/<runId>/`.

Other modules should not manually create files in the run directory. They should ask the artifact store to write files.

### Types to implement

```ts
export interface CreateRunInput {
  runId: string;
  outDir: string;
  workflowPath: string;
  workflowSource: string;
  workflowHash: string;
  resolvedConfig: unknown;
  execflowVersion: string;
  cwd: string;
  configPath?: string;
}

export interface RunArtifacts {
  runId: string;
  rootDir: string;
  manifestPath: string;
  workflowInputPath: string;
  resolvedConfigPath: string;
  eventsPath: string;
  reportPath: string;
  agentDir(agentId: string): string;
}

export interface ArtifactStore {
  createRun(input: CreateRunInput): Promise<RunArtifacts>;
  writeText(relativePath: string, content: string): Promise<string>;
  appendText(relativePath: string, content: string): Promise<string>;
  writeJson(relativePath: string, value: unknown): Promise<string>;
  appendJsonl(relativePath: string, value: unknown): Promise<string>;
  writeFinalReport(value: unknown): Promise<string>;
  updateManifest(status: "succeeded" | "failed" | "cancelled"): Promise<string>;
  getRunArtifacts(): RunArtifacts;
}
```

### Class to implement

```ts
export class FileSystemArtifactStore implements ArtifactStore {
  constructor(options: { rootDir?: string } = {}) {}

  async createRun(input: CreateRunInput): Promise<RunArtifacts> {}

  async writeText(relativePath: string, content: string): Promise<string> {}

  async appendText(relativePath: string, content: string): Promise<string> {}

  async writeJson(relativePath: string, value: unknown): Promise<string> {}

  async appendJsonl(relativePath: string, value: unknown): Promise<string> {}

  async writeFinalReport(value: unknown): Promise<string> {}

  async updateManifest(status: "succeeded" | "failed" | "cancelled"): Promise<string> {}

  getRunArtifacts(): RunArtifacts {}
}
```

### Required directory layout

When `createRun()` is called, create:

```text
<outDir>/<runId>/
  manifest.json
  workflow.input.ts
  config.resolved.json
  events.jsonl
  report.json      // created later
  agents/          // empty until agents run
```

### Atomic report writing

`writeFinalReport()` must not write directly to `report.json`.

Use this sequence:

1. Write to `report.json.tmp`.
2. Rename `report.json.tmp` to `report.json`.

Example:

```ts
const tmpPath = `${reportPath}.tmp`;
await fs.writeFile(tmpPath, JSON.stringify(value, null, 2));
await fs.rename(tmpPath, reportPath);
```

This prevents a crash from leaving a half-written `report.json`.

### Path safety

All write methods accept `relativePath`. Prevent path traversal:

```ts
function resolveInsideRoot(rootDir: string, relativePath: string): string {
  const fullPath = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);

  if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
    throw new Error(`Artifact path escapes run directory: ${relativePath}`);
  }

  return fullPath;
}
```

### Agent directory helper

Implement `agentDir(agentId)` so Dev C can write agent artifacts consistently:

```ts
agentDir(agentId: string): string {
  return path.join(rootDir, "agents", safeFileName(agentId));
}
```

Use a safe filename helper:

```ts
function safeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._:-]/g, "_");
}
```

### Files this store should write

At run start:

```text
manifest.json
workflow.input.ts
config.resolved.json
events.jsonl
```

During execution:

```text
events.jsonl
agents/<agentId>/prompt.txt
agents/<agentId>/stdout.log
agents/<agentId>/stderr.log
agents/<agentId>/raw-result.json
agents/<agentId>/normalized-result.json
agents/<agentId>/schema.json
agents/<agentId>/validation-error.json
```

At run finish:

```text
report.json
manifest.json
```

### Unit tests

Create `tests/unit/artifacts/run-store.test.ts`.

Test cases:

1. `createRun()` creates the run directory.
2. `createRun()` writes `manifest.json` with `status: "running"`.
3. `createRun()` writes `workflow.input.ts`.
4. `createRun()` writes `config.resolved.json`.
5. `createRun()` creates an empty `events.jsonl`.
6. `writeText()` writes a file inside the run directory.
7. `writeJson()` pretty-prints JSON.
8. `appendJsonl()` appends one JSON object per line.
9. `writeFinalReport()` writes through temp-file rename.
10. Path traversal like `../evil.txt` is rejected.
11. Partial files remain after simulated failure.

---

## 8. File: `src/artifacts/logs.ts`

### Purpose

Provide small helpers for agent log files.

This file should not contain complex runtime behavior. It is a convenience layer for writing prompt, stdout, stderr, and result files.

### Types to implement

```ts
export interface AgentArtifactPaths {
  dir: string;
  promptPath: string;
  stdoutPath: string;
  stderrPath: string;
  rawResultPath: string;
  normalizedResultPath: string;
  schemaPath: string;
  validationErrorPath: string;
}
```

### Functions to implement

```ts
export function getAgentArtifactPaths(rootDir: string, agentId: string): AgentArtifactPaths;

export async function ensureAgentArtifactDir(paths: AgentArtifactPaths): Promise<void>;
```

### Behavior

For `agentId = "review-auth"`, return:

```text
.execflow/runs/<runId>/agents/review-auth/prompt.txt
.execflow/runs/<runId>/agents/review-auth/stdout.log
.execflow/runs/<runId>/agents/review-auth/stderr.log
.execflow/runs/<runId>/agents/review-auth/raw-result.json
.execflow/runs/<runId>/agents/review-auth/normalized-result.json
.execflow/runs/<runId>/agents/review-auth/schema.json
.execflow/runs/<runId>/agents/review-auth/validation-error.json
```

### Junior engineer notes

- Keep file path generation in one place.
- Do not make Dev C manually build these paths repeatedly.
- Keep path names exactly as specified by the MVP.

---

# Part 3: Event Bus

## 9. File: `src/orchestration/event-bus.ts`

### Purpose

The event bus assigns event sequence numbers, persists each event, and forwards it to reporters.

### Interface to implement

```ts
export interface EventSubscriber {
  handle(event: EventEnvelope): Promise<void> | void;
}

export interface EventBusOptions {
  runId: string;
  artifactStore: Pick<ArtifactStore, "appendJsonl">;
  subscribers?: EventSubscriber[];
  now?: () => Date;
}

export class EventBus {
  constructor(options: EventBusOptions) {}

  emit<TPayload>(type: EventType, payload: TPayload): Promise<EventEnvelope<TPayload>> {}

  subscribe(subscriber: EventSubscriber): void {}

  getSequence(): number {}
}
```

### Required behavior

`emit()` must:

1. Increment the sequence counter.
2. Create an event envelope.
3. Append the event to `events.jsonl`.
4. Send the event to all subscribers.
5. Return the event.

### Event envelope example

```json
{
  "schemaVersion": "execflow.event.v1",
  "runId": "20260602-abc123",
  "sequence": 1,
  "timestamp": "2026-06-02T00:00:00.000Z",
  "type": "workflow.started",
  "payload": {
    "meta": {
      "name": "parallel-review",
      "description": "Review changed files"
    },
    "workflowPath": "examples/mock-review.js",
    "artifactsDir": ".execflow/runs/20260602-abc123"
  }
}
```

### Important ordering rule

Persist before notifying reporters when feasible:

```ts
await artifactStore.appendJsonl("events.jsonl", event);
for (const subscriber of subscribers) {
  await subscriber.handle(event);
}
```

This means a reporter should not show an event that was not saved.

### Error handling

For MVP, if event persistence fails, fail the run with an internal/artifact error. Do not silently continue without an event log.

If one reporter fails:

- In JSON/JSONL mode, this should generally fail the run because output is part of the contract.
- In pretty mode, decide with Dev A whether to fail or degrade. Recommended MVP behavior: fail clearly.

### Unit tests

Create `tests/unit/orchestration/event-bus.test.ts`.

Test cases:

1. First emitted event has `sequence: 1`.
2. Second emitted event has `sequence: 2`.
3. Event has `schemaVersion: "execflow.event.v1"`.
4. Event has ISO timestamp.
5. Event is appended to `events.jsonl` before subscriber receives it.
6. Subscriber receives emitted event.
7. Multiple subscribers receive same event.
8. Persistence failure rejects `emit()`.

---

# Part 4: Reporters

## 10. File: `src/output/reporter.ts`

### Purpose

Define the shared reporter interface and factory.

### Types to implement

```ts
export type ReporterMode = "pretty" | "json" | "jsonl";

export interface ReporterStartInput {
  runId: string;
  meta: {
    name: string;
    description: string;
    phases?: string[];
  };
  artifactsDir: string;
}

export interface Reporter {
  start(input: ReporterStartInput): Promise<void> | void;
  handle(event: EventEnvelope): Promise<void> | void;
  finish(result: WorkflowRunResult): Promise<void> | void;
}

export interface ReporterStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}
```

### Factory to implement

```ts
export function createReporter(options: {
  mode: ReporterMode;
  streams?: Partial<ReporterStreams>;
  verbose?: boolean;
}): Reporter {
  // return PrettyReporter, JsonReporter, or JsonlReporter
}
```

### Junior engineer notes

- Reporters should not write artifacts.
- Reporters should not control runtime execution.
- Reporters only receive events and final results.
- Pretty output can go to stdout.
- JSON final output must go to stdout.
- JSONL event output must go to stdout.
- Operational/debug logs in JSON or JSONL modes should go to stderr.

---

## 11. File: `src/output/jsonl-reporter.ts`

### Purpose

Stream one JSON event per line to stdout.

### Class to implement

```ts
export class JsonlReporter implements Reporter {
  constructor(streams: ReporterStreams) {}

  start(input: ReporterStartInput): void {}

  handle(event: EventEnvelope): void {}

  finish(result: WorkflowRunResult): void {}
}
```

### Behavior

- `start()` should not print anything unless the event bus itself emits `workflow.started`.
- `handle(event)` writes exactly one line:

```ts
stdout.write(JSON.stringify(event) + "\n");
```

- `finish()` should not print the final report unless the final report is also emitted as a normal event.
- Do not pretty-print JSONL.
- Do not write progress spinners.
- Do not write debug messages to stdout.

### Why this matters

CI systems parse JSONL line by line. Any extra text on stdout breaks consumers.

### Unit tests

Create `tests/unit/output/jsonl-reporter.test.ts`.

Test cases:

1. `handle()` writes one line.
2. The line is valid JSON.
3. The parsed JSON equals the event envelope.
4. `start()` writes nothing.
5. `finish()` writes nothing.
6. No output is written to stderr for normal events.

---

## 12. File: `src/output/json-reporter.ts`

### Purpose

Print exactly one final JSON object to stdout at the end of the run.

### Class to implement

```ts
export class JsonReporter implements Reporter {
  constructor(streams: ReporterStreams) {}

  start(input: ReporterStartInput): void {}

  handle(event: EventEnvelope): void {}

  finish(result: WorkflowRunResult): void {}
}
```

### Behavior

- `start()` writes nothing.
- `handle()` writes nothing.
- `finish(result)` writes exactly:

```ts
stdout.write(JSON.stringify(result, null, 2) + "\n");
```

### Important stdout rule

In JSON mode, stdout must contain only the final JSON report.

That means:

- no banners
- no progress updates
- no warnings
- no debug logs
- no artifact path messages outside the JSON object

If warnings are needed, write them to stderr.

### Unit tests

Create `tests/unit/output/json-reporter.test.ts`.

Test cases:

1. `start()` writes nothing.
2. `handle()` writes nothing.
3. `finish()` writes valid JSON.
4. Parsed JSON equals the result object.
5. There is exactly one JSON object in stdout.
6. Operational warning helper writes to stderr, not stdout.

---

## 13. File: `src/output/pretty-reporter.ts`

### Purpose

Render human-readable progress for local terminal users.

### Class to implement

```ts
export class PrettyReporter implements Reporter {
  constructor(streams: ReporterStreams, options?: { verbose?: boolean }) {}

  start(input: ReporterStartInput): void {}

  handle(event: EventEnvelope): void {}

  finish(result: WorkflowRunResult): void {}
}
```

### Minimum output

Pretty reporter should display:

- workflow name
- current phase
- agent started/completed/failed statuses
- provider name
- duration when known
- artifact directory at the end

Example:

```text
◇ parallel-review
  Phase: review

  ✓ codex-review       codex    18.3s
  ✕ gemini-review      gemini   failed

Artifacts:
  .execflow/runs/20260602-abc123
```

### Keep it simple for MVP

Do not implement a full live terminal UI yet. A simple append-only output is acceptable:

```text
◇ parallel-review
→ Phase: review
• codex-review queued [codex]
▶ codex-review started [codex]
✓ codex-review succeeded [codex] 18320ms
✕ gemini-review failed [gemini] Provider process failed
Artifacts: .execflow/runs/20260602-abc123
```

### Suggested implementation approach

Maintain small in-memory state:

```ts
interface PrettyState {
  workflowName?: string;
  currentPhase?: string;
  agents: Map<string, {
    label?: string;
    provider?: string;
    status: string;
    durationMs?: number;
  }>;
}
```

On each event:

- `workflow.started`: print workflow name
- `phase.started`: print phase line
- `workflow.log`: print log line
- `agent.queued`: print queued line if verbose
- `agent.started`: print started line
- `agent.output`: print only in verbose mode
- `agent.completed`: print success line
- `agent.failed`: print failure line
- `agent.timed_out`: print timeout line
- `agent.cancelled`: print cancelled line
- `workflow.failed`: print workflow failure summary
- `workflow.completed`: print workflow success summary

### Output formatting helpers

Create local helper functions:

```ts
function formatDuration(ms?: number): string {
  if (typeof ms !== "number") return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function displayAgentLabel(payload: { agentId: string; label?: string }): string {
  return payload.label ?? payload.agentId;
}
```

### Unit tests

Create `tests/unit/output/pretty-reporter.test.ts`.

Test cases:

1. `start()` prints workflow name.
2. `phase.started` prints phase.
3. `agent.started` prints label and provider.
4. `agent.completed` prints success mark.
5. `agent.failed` prints failure mark and message.
6. `finish()` prints artifact directory.
7. `agent.output` is hidden unless verbose is true.
8. `agent.output` is shown when verbose is true.

---

# Part 5: Integration Fixtures

## 14. File: `tests/fixtures/workflows/mock-success.workflow.js`

### Purpose

Provide a tiny workflow that should always succeed with the mock provider.

### Content

```js
export const meta = {
  name: "mock-success",
  description: "Simple successful mock workflow",
  phases: ["review", "summarize"]
};

phase("review");

const review = await agent({
  id: "review-auth",
  provider: "mock",
  prompt: "Review src/auth.ts"
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "mock",
  prompt: `Summarize: ${JSON.stringify(review)}`
});

export default {
  review,
  summary
};
```

### Expected result

- workflow succeeds
- two agent directories exist
- final report has two agents
- event log includes phases and agent lifecycle events

---

## 15. File: `tests/fixtures/workflows/mock-failure.workflow.js`

### Purpose

Verify failed agents are captured as structured results and artifacts are preserved.

### Content

```js
export const meta = {
  name: "mock-failure",
  description: "Mock workflow with one failed agent",
  phases: ["review"]
};

phase("review");

const reviews = await parallel({
  ok: () => agent({
    id: "review-ok",
    provider: "mock",
    prompt: "This one should succeed."
  }),
  fail: () => agent({
    id: "review-fail",
    provider: "mock",
    prompt: "This one should fail.",
    metadata: { mockResponseKey: "failure" }
  })
});

export default { reviews };
```

### Expected result

- workflow may still complete depending on runtime policy
- failed agent has `ok: false`
- failed agent has stdout/stderr artifacts
- final report includes the failed agent
- events include `agent.failed`

Coordinate final failure semantics with Dev B.

---

## 16. File: `tests/fixtures/workflows/mock-schema-failure.workflow.js`

### Purpose

Verify validation errors are visible in reports and artifacts.

### Content

```js
export const meta = {
  name: "mock-schema-failure",
  description: "Mock workflow with schema validation failure",
  phases: ["validate"]
};

phase("validate");

const result = await agent({
  id: "schema-fail",
  provider: "mock",
  prompt: "Return invalid JSON for this schema.",
  metadata: { mockResponseKey: "invalid-schema" },
  schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["findings"]
  }
});

export default { result };
```

### Expected result

- agent result has `ok: false`
- `error.code` is `SCHEMA_VALIDATION_FAILED`
- `validation-error.json` exists
- `raw-result.json` exists
- `normalized-result.json` may exist if parsing succeeded

Coordinate exact schema failure behavior with Dev C.

---

## 17. File: `tests/fixtures/config/mock.config.yaml`

### Purpose

Provide deterministic mock-provider responses for integration tests.

### Content

```yaml
defaultProvider: mock
concurrency: 2
timeoutMs: 30000

providers:
  mock:
    command: mock
    responses:
      default:
        text: "mock response"
      review-auth:
        json:
          findings: []
      summary:
        text: "summary response"
      failure:
        error:
          message: "configured mock failure"
          code: "MOCK_FAILURE"
      invalid-schema:
        json:
          wrongField: true

security:
  passEnv: []
  redactEnv:
    - OPENAI_API_KEY
    - GEMINI_API_KEY
    - GOOGLE_API_KEY
    - "*_TOKEN"
    - "*_SECRET"
```

### Notes

Dev C owns the mock provider implementation. This config is Developer D's fixture to use in integration tests. If Dev C chooses a slightly different mock config shape, update this fixture to match.

---

# Part 6: Integration Tests

## 18. File: `tests/integration/mock-run-success.test.ts`

### Purpose

Verify the happy path across CLI/runtime/artifacts/reporters using mock provider.

### Test steps

1. Create a temporary working directory.
2. Copy `mock-success.workflow.js` into it.
3. Copy `mock.config.yaml` into `.execflow/config.yaml`.
4. Run:

```bash
execflow run mock-success.workflow.js --provider mock --report pretty
```

5. Find `.execflow/runs/<runId>`.
6. Assert expected files exist.
7. Parse `report.json`.
8. Parse `events.jsonl`.

### Assertions

- command exits with code `0`
- run directory exists
- `manifest.json` exists
- `manifest.status` is `succeeded`
- `workflow.input.ts` exists
- `config.resolved.json` exists
- `events.jsonl` exists
- `report.json` exists
- `agents/review-auth/prompt.txt` exists
- `agents/review-auth/stdout.log` exists
- `agents/review-auth/stderr.log` exists
- `report.schemaVersion` is `execflow.report.v1`
- events have strictly increasing sequence numbers

---

## 19. File: `tests/integration/mock-run-failure.test.ts`

### Purpose

Verify partial artifacts survive an agent failure.

### Test steps

Run:

```bash
execflow run mock-failure.workflow.js --provider mock --report pretty
```

### Assertions

- command exits according to final workflow failure policy agreed with Dev B
- run directory exists even if command exits non-zero
- `manifest.json` exists
- `events.jsonl` exists
- `report.json` exists if final reporting was possible
- failed agent directory exists
- failed agent prompt exists
- failed agent stdout/stderr files exist
- report includes failed agent
- event log includes `agent.failed`

### Junior engineer note

Do not assume every agent failure means the whole workflow exits `1`. The MVP says agent failures are structured results by default. Confirm the final behavior with Dev B.

---

## 20. File: `tests/integration/mock-run-json.test.ts`

### Purpose

Verify `--report json` stdout is clean and parseable.

### Test steps

Run:

```bash
execflow run mock-success.workflow.js --provider mock --report json
```

Capture stdout and stderr separately.

### Assertions

- stdout is valid JSON
- stdout parses to a `WorkflowRunResult`
- stdout contains no pretty-progress symbols
- stdout contains no extra lines before or after JSON
- stderr may contain operational warnings but should normally be empty
- persisted `report.json` exists
- persisted `report.json` matches the same schema as stdout

---

## 21. File: `tests/integration/mock-run-jsonl.test.ts`

### Purpose

Verify `--report jsonl` stdout contains one event envelope per line.

### Test steps

Run:

```bash
execflow run mock-success.workflow.js --provider mock --report jsonl
```

### Assertions

- stdout has at least one non-empty line
- every non-empty line is valid JSON
- every parsed object has `schemaVersion: "execflow.event.v1"`
- event sequence numbers are strictly increasing
- stdout event stream matches persisted `events.jsonl`
- stdout contains no pretty-progress text
- stdout contains no final pretty summary outside events

---

## 22. File: `tests/integration/mock-run-artifacts.test.ts`

### Purpose

Verify artifact directory layout exactly matches the MVP contract.

### Assertions

After a successful run:

```text
.execflow/runs/<runId>/manifest.json
.execflow/runs/<runId>/workflow.input.ts
.execflow/runs/<runId>/config.resolved.json
.execflow/runs/<runId>/events.jsonl
.execflow/runs/<runId>/report.json
.execflow/runs/<runId>/agents/<agentId>/prompt.txt
.execflow/runs/<runId>/agents/<agentId>/stdout.log
.execflow/runs/<runId>/agents/<agentId>/stderr.log
.execflow/runs/<runId>/agents/<agentId>/raw-result.json
.execflow/runs/<runId>/agents/<agentId>/normalized-result.json
```

When schema is used:

```text
.execflow/runs/<runId>/agents/<agentId>/schema.json
```

When schema validation fails:

```text
.execflow/runs/<runId>/agents/<agentId>/validation-error.json
```

---

# Part 7: Example Workflow

## 23. File: `examples/mock-review.js`

### Purpose

Provide a user-facing example workflow that runs without real Codex or Gemini credentials.

### Content

```js
export const meta = {
  name: "mock-review",
  description: "Demonstrates execflow with the mock provider",
  phases: ["review", "summarize"]
};

phase("review");

log("Starting mock review");

const reviews = await parallel({
  auth: () => agent({
    id: "review-auth",
    provider: "mock",
    prompt: "Review src/auth.ts for correctness issues.",
    schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["findings"]
    }
  }),
  billing: () => agent({
    id: "review-billing",
    provider: "mock",
    prompt: "Review src/billing.ts for API design issues."
  })
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "mock",
  prompt: `Summarize these reviews:\n${JSON.stringify(reviews, null, 2)}`
});

export default {
  reviews,
  summary
};
```

### User commands this example should support

```bash
execflow run examples/mock-review.js --provider mock --report pretty
execflow run examples/mock-review.js --provider mock --report json
execflow run examples/mock-review.js --provider mock --report jsonl
```

---

# Part 8: Integration With Other Developers

## 24. Dev A Integration Points

Dev A owns CLI and config. Coordinate these interfaces:

```ts
createReporter({ mode, streams, verbose })
new FileSystemArtifactStore({ rootDir: outDir })
artifactStore.createRun(...)
```

Dev A needs from you:

- reporter factory
- artifact store class
- final report writing method
- predictable stdout behavior

Ask Dev A to pass:

- `--out` value as artifact root
- `--report` value as reporter mode
- resolved config object
- workflow source and source hash
- final `WorkflowRunResult`

---

## 25. Dev B Integration Points

Dev B owns runtime and scheduler. Coordinate these interfaces:

```ts
eventBus.emit("phase.started", { name })
eventBus.emit("workflow.log", { message, data })
eventBus.emit("agent.queued", { agentId, label, provider })
eventBus.emit("agent.started", { agentId, label, provider, cwd })
eventBus.emit("agent.completed", { ... })
eventBus.emit("agent.failed", { ... })
```

Dev B needs from you:

- event bus class
- event types
- reporter subscription pattern
- artifact store write helpers

Ask Dev B to:

- emit lifecycle events consistently
- include `agentId` on every agent event
- include `provider` on every agent event
- include `durationMs` on terminal agent events
- call `finish(result)` on reporters after final report exists

---

## 26. Dev C Integration Points

Dev C owns providers, process runner, and structured validation. Coordinate these interfaces:

```ts
getAgentArtifactPaths(rootDir, agentId)
artifactStore.writeText(`agents/${agentId}/prompt.txt`, prompt)
artifactStore.appendText(`agents/${agentId}/stdout.log`, chunk)
artifactStore.appendText(`agents/${agentId}/stderr.log`, chunk)
artifactStore.writeJson(`agents/${agentId}/raw-result.json`, raw)
artifactStore.writeJson(`agents/${agentId}/normalized-result.json`, normalized)
artifactStore.writeJson(`agents/${agentId}/schema.json`, schema)
artifactStore.writeJson(`agents/${agentId}/validation-error.json`, error)
```

Dev C needs from you:

- stable artifact file names
- agent artifact path helpers
- append-safe stdout/stderr log writing
- event bus support for `agent.output`

Ask Dev C to:

- write raw outputs even when parsing fails
- write stderr even when process exits non-zero
- keep validation errors in `validation-error.json`
- avoid printing provider logs directly to stdout in JSON/JSONL modes

---

# Part 9: Definition of Done

## 27. Developer D is done when these are true

### Artifact store

- `createRun()` creates the MVP directory structure.
- `manifest.json` starts with `status: "running"`.
- `workflow.input.ts` is persisted.
- `config.resolved.json` is persisted.
- `events.jsonl` is append-only and line-delimited.
- `report.json` is written atomically.
- Manifest is updated at run completion.
- Path traversal writes are rejected.

### Event bus

- Every event has `schemaVersion: "execflow.event.v1"`.
- Every event has a strictly increasing sequence number.
- Every event has an ISO timestamp.
- Events are persisted before reporters see them where feasible.
- JSONL reporter stdout matches persisted `events.jsonl`.

### Reporters

- Pretty reporter is readable for humans.
- JSON reporter prints only final JSON to stdout.
- JSONL reporter prints only event JSONL to stdout.
- Operational logs do not corrupt JSON/JSONL stdout.
- Reporters do not control execution.

### Tests

- Unit tests pass for artifact store.
- Unit tests pass for event bus.
- Unit tests pass for reporters.
- Integration tests pass with mock provider.
- Golden JSON/JSONL tests are stable.
- Tests do not require Codex or Gemini credentials.

---

# Part 10: Common Mistakes to Avoid

## 28. Do not write directly to stdout from random modules

Only reporters should write user-visible output.

Bad:

```ts
console.log("agent started");
```

Good:

```ts
await eventBus.emit("agent.started", payload);
```

Then the reporter decides what to print.

---

## 29. Do not let JSON mode print progress

Bad stdout in JSON mode:

```text
Starting workflow...
{"schemaVersion":"execflow.report.v1", ...}
Done!
```

Good stdout in JSON mode:

```json
{
  "schemaVersion": "execflow.report.v1",
  "runId": "20260602-abc123"
}
```

---

## 30. Do not overwrite `events.jsonl`

Events must be appended. Never rewrite the event log after the run starts.

---

## 31. Do not lose partial artifacts

If a provider fails, stdout/stderr should still exist. If schema validation fails, raw result should still exist.

---

## 32. Do not implement post-MVP features

Do not implement these in Developer D's MVP work:

- static HTML reports
- hosted dashboard
- artifact retention cleanup
- resumable event replay
- rich terminal UI
- patch review UI
- provider plugins

Leave clean extension points, but keep the MVP small.

---

# Part 11: Suggested Pull Requests

## 33. PR 1: Artifact store foundation

Files:

```text
src/artifacts/manifest.ts
src/artifacts/run-store.ts
src/artifacts/logs.ts
tests/unit/artifacts/manifest.test.ts
tests/unit/artifacts/run-store.test.ts
```

Acceptance criteria:

- synthetic run writes manifest, workflow input, config, events file
- final report is atomic
- path traversal is rejected

---

## 34. PR 2: Event bus

Files:

```text
src/output/events.ts
src/orchestration/event-bus.ts
tests/unit/orchestration/event-bus.test.ts
```

Acceptance criteria:

- events get sequence numbers
- events are persisted to JSONL
- subscribers receive events

---

## 35. PR 3: Reporter interface and JSONL reporter

Files:

```text
src/output/reporter.ts
src/output/jsonl-reporter.ts
tests/unit/output/jsonl-reporter.test.ts
```

Acceptance criteria:

- JSONL reporter emits valid one-event-per-line output
- `start()` and `finish()` do not add extra output

---

## 36. PR 4: JSON and pretty reporters

Files:

```text
src/output/json-reporter.ts
src/output/pretty-reporter.ts
tests/unit/output/json-reporter.test.ts
tests/unit/output/pretty-reporter.test.ts
```

Acceptance criteria:

- JSON reporter emits final report only
- pretty reporter shows workflow, phase, agent, and artifact path info

---

## 37. PR 5: Integration fixtures and artifact tests

Files:

```text
tests/fixtures/workflows/mock-success.workflow.js
tests/fixtures/workflows/mock-failure.workflow.js
tests/fixtures/workflows/mock-schema-failure.workflow.js
tests/fixtures/config/mock.config.yaml
tests/integration/mock-run-success.test.ts
tests/integration/mock-run-failure.test.ts
tests/integration/mock-run-json.test.ts
tests/integration/mock-run-jsonl.test.ts
tests/integration/mock-run-artifacts.test.ts
examples/mock-review.js
```

Acceptance criteria:

- mock success workflow passes
- artifact layout is verified
- JSON output is clean
- JSONL output is ordered
- failed runs preserve partial artifacts

---

## 38. Final Checklist for Developer D

Before marking your work complete, run:

```bash
pnpm lint
pnpm test:types
pnpm test tests/unit/artifacts
pnpm test tests/unit/orchestration/event-bus.test.ts
pnpm test tests/unit/output
pnpm test tests/integration
```

Then manually verify:

```bash
execflow run examples/mock-review.js --provider mock --report pretty
execflow run examples/mock-review.js --provider mock --report json
execflow run examples/mock-review.js --provider mock --report jsonl
```

Check that:

- pretty mode is readable
- JSON mode is parseable with `jq`
- JSONL mode is parseable line by line
- `.execflow/runs/<runId>` contains the expected files
- failed agents still have artifacts
- no tests require real Codex or Gemini credentials

