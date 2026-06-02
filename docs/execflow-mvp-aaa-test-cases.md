# execflow MVP Acceptance Test Cases — AAA Pattern

**Document type:** QA / Engineering Test Plan  
**Project:** execflow  
**Scope:** MVP acceptance criteria  
**Pattern:** Arrange / Act / Assert  
**Date:** 2026-06-02

---

## 1. Purpose

This document outlines test cases for the execflow MVP acceptance criteria using the **AAA pattern**:

- **Arrange:** Prepare fixtures, config, mock provider behavior, filesystem state, and command inputs.
- **Act:** Run the CLI command, runtime function, provider adapter, or integration path under test.
- **Assert:** Verify command output, exit code, events, artifacts, reports, and structured results.

The goal is to give the engineering team a clear test matrix for validating the MVP before release.

---

## 2. Source MVP Acceptance Criteria

The MVP is considered complete when the following acceptance criteria are satisfied:

| ID | Acceptance criterion |
|---|---|
| AC-01 | `execflow validate workflow.ts` validates metadata and rejects restricted workflow behavior. |
| AC-02 | `execflow run workflow.ts` executes a valid workflow. |
| AC-03 | `agent()` can call mock, Codex, and Gemini providers through adapters. |
| AC-04 | `parallel()` runs multiple agent calls under a global concurrency limit. |
| AC-05 | Failed agents return structured failure results. |
| AC-06 | Timeouts terminate provider processes and preserve logs. |
| AC-07 | Prompts, stdout, stderr, normalized results, events, manifests, and final reports are persisted. |
| AC-08 | `--report pretty`, `--report json`, and `--report jsonl` work correctly. |
| AC-09 | JSON Schema validation works and failure artifacts are created. |
| AC-10 | `execflow doctor` detects missing provider CLIs. |
| AC-11 | Exit codes match the documented table. |
| AC-12 | The default test suite passes without real provider credentials. |

---

## 3. Recommended Test Suite Layout

```text
execflow/
  tests/
    fixtures/
      workflows/
        valid-basic.workflow.js
        valid-parallel.workflow.js
        valid-schema-success.workflow.js
        valid-schema-failure.workflow.js
        invalid-missing-meta.workflow.js
        invalid-dynamic-meta.workflow.js
        invalid-require.workflow.js
        invalid-import.workflow.js
        invalid-process.workflow.js
        invalid-filesystem.workflow.js
        invalid-pipeline.workflow.js
      config/
        valid-config.yaml
        mock-provider-config.yaml
        missing-provider-config.yaml
      provider-output/
        codex-text.stdout
        codex-json.stdout
        gemini-text.stdout
        gemini-json.stdout
        malformed-json.stdout
    unit/
      workflow-validate.test.ts
      config.test.ts
      event-bus.test.ts
      artifact-store.test.ts
      schema-validation.test.ts
      process-runner.test.ts
      exit-codes.test.ts
    integration/
      validate-command.test.ts
      run-basic.test.ts
      run-parallel.test.ts
      reports.test.ts
      artifacts.test.ts
      timeout.test.ts
      fail-fast.test.ts
      doctor.test.ts
    adapters/
      mock-adapter.test.ts
      codex-adapter.test.ts
      gemini-adapter.test.ts
```

---

## 4. Shared Test Fixtures

### 4.1 Basic valid workflow

```ts
export const meta = {
  name: "basic-review",
  description: "Basic mock provider review"
};

phase("review");

const result = await agent({
  id: "review-1",
  provider: "mock",
  prompt: "Review src/auth.ts"
});

export default { result };
```

### 4.2 Parallel workflow

```ts
export const meta = {
  name: "parallel-review",
  description: "Parallel mock provider review",
  phases: ["review"]
};

phase("review");

const reviews = await parallel({
  auth: () => agent({
    id: "review-auth",
    provider: "mock",
    prompt: "Review src/auth.ts"
  }),
  billing: () => agent({
    id: "review-billing",
    provider: "mock",
    prompt: "Review src/billing.ts"
  }),
  api: () => agent({
    id: "review-api",
    provider: "mock",
    prompt: "Review src/api.ts"
  })
});

export default { reviews };
```

### 4.3 Schema success workflow

```ts
export const meta = {
  name: "schema-success",
  description: "Validates structured mock output"
};

const result = await agent({
  id: "schema-agent",
  provider: "mock",
  prompt: "Return structured findings",
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

### 4.4 Mock config

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
      schema-agent:
        json:
          findings: []

security:
  passEnv: []
  redactEnv:
    - OPENAI_API_KEY
    - GEMINI_API_KEY
    - GOOGLE_API_KEY
    - '*_TOKEN'
    - '*_SECRET'
```

---

## 5. AC-01 — Workflow validation

### TC-01.01 — Valid metadata passes validation

**Type:** Integration  
**Command:** `execflow validate tests/fixtures/workflows/valid-basic.workflow.js`

**Arrange**

- Create a workflow file whose first top-level statement is `export const meta = { ... }`.
- Include required `meta.name` and `meta.description` string literals.
- Use only supported MVP DSL calls: `phase()`, `log()`, `agent()`, and `parallel()`.

**Act**

- Run `execflow validate valid-basic.workflow.js`.

**Assert**

- CLI exits with code `0`.
- stdout or stderr contains a clear validation success message.
- No run artifact directory is created unless validation intentionally records diagnostics.

---

### TC-01.02 — Missing metadata fails validation

**Type:** Integration  
**Command:** `execflow validate tests/fixtures/workflows/invalid-missing-meta.workflow.js`

**Arrange**

- Create a workflow file with no `export const meta` statement.

**Act**

- Run `execflow validate invalid-missing-meta.workflow.js`.

**Assert**

- CLI exits with code `3`.
- Error code is `WORKFLOW_VALIDATION_ERROR` or `WORKFLOW_PARSE_ERROR`.
- Error message explains that metadata is required.
- No provider is invoked.

---

### TC-01.03 — Metadata not first statement fails validation

**Type:** Integration

**Arrange**

- Create a workflow where another statement appears before `export const meta`.

**Act**

- Run `execflow validate` against the workflow.

**Assert**

- CLI exits with code `3`.
- Error message explains that `meta` must be the first top-level statement.
- No provider is invoked.

---

### TC-01.04 — Dynamic metadata fails validation

**Type:** Unit / Integration

**Arrange**

- Create workflow metadata using a dynamic expression:

```ts
const name = "dynamic";
export const meta = {
  name,
  description: "Invalid dynamic metadata"
};
```

**Act**

- Run validator directly in a unit test and through `execflow validate` in an integration test.

**Assert**

- Validator rejects the workflow.
- CLI exits with code `3`.
- Error explains that metadata must be statically analyzable.

---

### TC-01.05 — Restricted `require()` fails validation

**Type:** Unit / Integration

**Arrange**

- Create a workflow containing `require("fs")`.

**Act**

- Run `execflow validate`.

**Assert**

- CLI exits with code `3` or `5`, depending on whether this is classified as validation or security policy.
- Error includes a stable code such as `WORKFLOW_VALIDATION_ERROR` or `SECURITY_POLICY_VIOLATION`.
- Error message identifies `require()` as unsupported.

---

### TC-01.06 — Unsupported `pipeline()` fails validation

**Type:** Unit / Integration

**Arrange**

- Create a workflow that calls `pipeline()`.

**Act**

- Run `execflow validate`.

**Assert**

- CLI exits with code `3`.
- Error explains that `pipeline()` is not supported in MVP.
- No provider is invoked.

---

## 6. AC-02 — Running a valid workflow

### TC-02.01 — Basic workflow runs successfully with mock provider

**Type:** Integration  
**Command:** `execflow run tests/fixtures/workflows/valid-basic.workflow.js --provider mock --config tests/fixtures/config/mock-provider-config.yaml`

**Arrange**

- Prepare a valid workflow that calls a single mock agent.
- Configure mock provider with deterministic default text output.
- Use a temporary output directory for `.execflow/runs`.

**Act**

- Run the workflow using `execflow run`.

**Assert**

- CLI exits with code `0`.
- Final workflow status is `succeeded`.
- A run directory is created.
- Final report contains workflow metadata.
- Final report contains exactly one agent result.
- Agent result has `ok: true` and `status: "succeeded"`.

---

### TC-02.02 — Workflow phases and logs are emitted

**Type:** Integration

**Arrange**

- Create a workflow that calls:
  - `phase("scan")`
  - `log("Scanning files")`
  - `phase("review")`
  - `agent(...)`

**Act**

- Run with `--report jsonl`.

**Assert**

- JSONL output includes ordered events:
  - `workflow.started`
  - `phase.started` with `scan`
  - `workflow.log`
  - `phase.started` with `review`
  - `agent.queued`
  - `agent.started`
  - `agent.completed`
  - `workflow.completed`
- Every event has `schemaVersion`, `runId`, `sequence`, `timestamp`, `type`, and `payload`.

---

## 7. AC-03 — Provider adapter execution

### TC-03.01 — Mock provider adapter succeeds

**Type:** Adapter / Integration

**Arrange**

- Register the mock adapter.
- Configure deterministic response for agent ID `review-1`.

**Act**

- Run a workflow with `agent({ id: "review-1", provider: "mock", ... })`.

**Assert**

- Adapter returns normalized result.
- Agent result has `provider: "mock"`.
- stdout, stderr, text/json, exit code, and duration are present.
- No real external CLI is invoked.

---

### TC-03.02 — Codex adapter builds expected command

**Type:** Adapter fixture test

**Arrange**

- Configure Codex provider:

```yaml
providers:
  codex:
    command: codex
    args:
      - exec
      - --json
      - --ephemeral
```

- Prepare an `AgentRunInput` with prompt, cwd, timeout, and provider `codex`.

**Act**

- Call `CodexAdapter.buildCommand(input)`.

**Assert**

- Command is `codex`.
- Args include configured static args.
- Prompt is passed via stdin when supported by the adapter.
- cwd is preserved.
- Env is filtered according to security policy.

---

### TC-03.03 — Gemini adapter builds expected command

**Type:** Adapter fixture test

**Arrange**

- Configure Gemini provider:

```yaml
providers:
  gemini:
    command: gemini
    args:
      - --output-format
      - json
```

- Prepare an `AgentRunInput` with prompt, cwd, timeout, and provider `gemini`.

**Act**

- Call `GeminiAdapter.buildCommand(input)`.

**Assert**

- Command is `gemini`.
- Args include `-p` or the configured prompt-passing mechanism.
- Args include configured output format.
- cwd is preserved.
- Env is filtered according to security policy.

---

### TC-03.04 — Unknown provider returns clear error

**Type:** Unit / Integration

**Arrange**

- Create a workflow with `provider: "unknown-provider"`.

**Act**

- Run `execflow run workflow.js`.

**Assert**

- CLI exits with code `4`.
- Error code is `PROVIDER_UNAVAILABLE`.
- Message includes the unknown provider name.
- No run proceeds beyond provider resolution.

---

## 8. AC-04 — Parallel execution and global concurrency limit

### TC-04.01 — `parallel()` runs multiple agents

**Type:** Integration

**Arrange**

- Create a workflow that calls `parallel()` with three mock agent tasks.
- Mock all agents to succeed.

**Act**

- Run workflow with `--concurrency 3`.

**Assert**

- Final report includes three agent results.
- All three agent results have `status: "succeeded"`.
- Result object preserves branch names when object-form `parallel()` is used.

---

### TC-04.02 — Global concurrency limit is enforced

**Type:** Integration / Scheduler unit test

**Arrange**

- Create a workflow with five mock agents.
- Configure each mock agent to delay for a measurable duration.
- Run with `--concurrency 2`.
- Instrument mock adapter or scheduler to record active agent count.

**Act**

- Run the workflow.

**Assert**

- No more than two agents are in `running` state at the same time.
- All five agents eventually settle unless fail-fast or cancellation is enabled.
- Event stream shows queued tasks before later starts.
- Final report includes all five agent results.

---

### TC-04.03 — `parallel()` waits for all branches to settle by default

**Type:** Integration

**Arrange**

- Create a workflow with three parallel agents:
  - one succeeds
  - one fails
  - one succeeds after a delay
- Do not enable `--fail-fast`.

**Act**

- Run the workflow.

**Assert**

- All three branches complete or fail individually.
- `parallel()` returns a result for each branch.
- Failed branch is represented as `AgentFailureResult`.
- Workflow can still complete if workflow code handles the failed result.

---

## 9. AC-05 — Structured failed agent results

### TC-05.01 — Non-zero provider exit becomes `AgentFailureResult`

**Type:** Integration / Adapter fixture

**Arrange**

- Configure mock provider so agent `failing-agent` returns non-zero exit code.
- Ensure stdout and stderr contain diagnostic content.

**Act**

- Run workflow with that agent.

**Assert**

- Agent result has `ok: false`.
- Agent result has `status: "failed"`.
- Agent result includes `error.name`, `error.message`, and `error.code`.
- stdout and stderr are preserved in result and artifacts.
- Final report includes the failed agent clearly.

---

### TC-05.02 — Failed agent does not necessarily abort workflow

**Type:** Integration

**Arrange**

- Create workflow:
  - first agent fails
  - second agent succeeds
  - workflow exports both results
- Do not enable `--fail-fast`.

**Act**

- Run workflow.

**Assert**

- Both agent results appear in final report.
- Failed agent is structured as failure.
- Successful agent is structured as success.
- Workflow status follows implemented policy based on final workflow behavior, not raw provider failure alone.

---

### TC-05.03 — `--fail-fast` skips queued work and aborts active work

**Type:** Integration

**Arrange**

- Create workflow with several parallel mock agents.
- Configure first started agent to fail quickly.
- Configure other agents to delay.
- Run with `--fail-fast --concurrency 2`.

**Act**

- Run workflow.

**Assert**

- First failed agent appears as `failed`.
- Running agents receive cancellation and become `cancelled` or `failed` according to implementation policy.
- Queued agents become `skipped`.
- Final report includes partial results.
- CLI exits non-zero.

---

## 10. AC-06 — Timeout handling

### TC-06.01 — Timed-out process is terminated

**Type:** Process runner unit test / Integration

**Arrange**

- Configure mock provider or process runner fixture to run longer than `timeoutMs`.
- Use a short timeout such as `100ms`.

**Act**

- Run the agent call.

**Assert**

- Process is terminated.
- Agent result has `ok: false`.
- Agent status is `timed_out`.
- Error code is `PROCESS_TIMEOUT`.
- Exit code is `null` or the platform-specific killed process exit code.
- Duration is at least timeout value and within reasonable overhead.

---

### TC-06.02 — Timeout preserves partial logs

**Type:** Integration

**Arrange**

- Configure mock provider to emit stdout and stderr before hanging.
- Set short timeout.

**Act**

- Run workflow.

**Assert**

- Agent artifact directory exists.
- `stdout.log` contains partial stdout emitted before timeout.
- `stderr.log` contains partial stderr emitted before timeout.
- `events.jsonl` includes `agent.timed_out`.
- Final report references the artifact paths.

---

## 11. AC-07 — Artifact persistence

### TC-07.01 — Successful run writes required run artifacts

**Type:** Integration

**Arrange**

- Create a valid workflow with one successful mock agent.
- Use a temporary output directory.

**Act**

- Run workflow.

**Assert**

- Run directory exists at `.execflow/runs/<runId>` or configured `--out` path.
- Required files exist:
  - `manifest.json`
  - `workflow.input.ts` or `workflow.input.js`
  - `config.resolved.json`
  - `events.jsonl`
  - `report.json`
- Agent directory exists under `agents/<agentId>/`.
- Required agent files exist:
  - `prompt.txt`
  - `stdout.log`
  - `stderr.log`
  - `raw-result.json`
  - `normalized-result.json`

---

### TC-07.02 — Manifest is written before workflow execution

**Type:** Artifact store unit test / Integration with failing workflow

**Arrange**

- Create a workflow that throws during runtime after artifacts are initialized.

**Act**

- Run workflow.

**Assert**

- Run directory exists despite failure.
- `manifest.json` exists.
- Initial manifest was written with `status: "running"` before final update.
- Final manifest status is `failed`.
- `report.json` exists if final reporting was possible.

---

### TC-07.03 — Events are appended incrementally

**Type:** Unit / Integration

**Arrange**

- Create a workflow with phases and multiple agents.

**Act**

- Run workflow and inspect `events.jsonl`.

**Assert**

- File contains one valid JSON object per line.
- Every event has strictly increasing `sequence`.
- `events.jsonl` is still present after failed runs.
- The persisted event stream matches JSONL reporter output when `--report jsonl` is used.

---

### TC-07.04 — Final report is written atomically

**Type:** Artifact store unit test

**Arrange**

- Use artifact store with a fake filesystem or temp directory.
- Simulate final report write.

**Act**

- Call `writeFinalReport(result)`.

**Assert**

- Final `report.json` exists.
- No partially written report is visible under normal completion.
- Temp file is renamed into place.
- If write fails, error is classified as `ARTIFACT_WRITE_FAILED`.

---

## 12. AC-08 — Reporter modes

### TC-08.01 — Pretty reporter displays human progress

**Type:** Integration

**Arrange**

- Create workflow with phases and two agents.
- Use `--report pretty`.

**Act**

- Run workflow in a terminal-like test environment.

**Assert**

- Output includes workflow name.
- Output includes current or completed phase.
- Output includes agent labels, provider names, statuses, and durations.
- Output includes artifact directory path.
- Output is human-readable and does not need to be valid JSON.

---

### TC-08.02 — JSON reporter emits final JSON only to stdout

**Type:** Integration

**Arrange**

- Create successful mock workflow.
- Use `--report json`.

**Act**

- Capture stdout and stderr separately.

**Assert**

- stdout is exactly one valid JSON object.
- stdout parses as `WorkflowRunResult`.
- stdout does not contain progress text.
- Operational logs, if any, are on stderr.
- JSON includes run ID, status, metadata, agents, durations, artifact paths, report path, and events path.

---

### TC-08.03 — JSONL reporter emits ordered event stream

**Type:** Integration

**Arrange**

- Create workflow with phase, log, and agent events.
- Use `--report jsonl`.

**Act**

- Capture stdout.

**Assert**

- stdout contains one valid JSON event envelope per line.
- Every event sequence is strictly increasing.
- Event stream includes `workflow.started` and terminal workflow event.
- stdout does not contain pretty progress text.
- Persisted `events.jsonl` matches emitted event stream.

---

## 13. AC-09 — JSON Schema validation

### TC-09.01 — Valid structured output succeeds

**Type:** Integration

**Arrange**

- Create workflow with an agent schema requiring `findings: string[]`.
- Configure mock provider to return `{ "findings": [] }`.

**Act**

- Run workflow.

**Assert**

- Agent result has `ok: true`.
- Agent result has `status: "succeeded"`.
- Agent result includes `json.findings`.
- `schema.json` artifact exists.
- `normalized-result.json` contains validated JSON.

---

### TC-09.02 — Invalid structured output fails agent

**Type:** Integration

**Arrange**

- Create workflow with schema requiring `findings: string[]`.
- Configure mock provider to return `{ "summary": "not valid" }`.

**Act**

- Run workflow.

**Assert**

- Agent result has `ok: false`.
- Agent result has `status: "failed"`.
- Error code is `SCHEMA_VALIDATION_FAILED`.
- `validation-error.json` artifact exists.
- Raw stdout/stderr artifacts are preserved.

---

### TC-09.03 — Malformed JSON fails when schema is required

**Type:** Unit / Integration

**Arrange**

- Create workflow with schema.
- Configure mock provider to return non-JSON text.

**Act**

- Run workflow.

**Assert**

- Agent result has `ok: false`.
- Error code is `SCHEMA_VALIDATION_FAILED` or a specific JSON extraction error that maps to schema failure.
- Validation error artifact explains no valid JSON object could be extracted.
- No retry is attempted in MVP.

---

### TC-09.04 — Plain text succeeds when no schema is required

**Type:** Integration

**Arrange**

- Create workflow with no schema.
- Configure mock provider to return plain text.

**Act**

- Run workflow.

**Assert**

- Agent result has `ok: true`.
- Agent result has `text` or stdout fallback populated.
- No `validation-error.json` artifact is created.

---

## 14. AC-10 — `execflow doctor`

### TC-10.01 — Doctor reports missing Codex CLI

**Type:** Integration

**Arrange**

- Run tests with PATH modified so `codex` is unavailable.
- Configure provider `codex` in config.

**Act**

- Run `execflow doctor --config missing-provider-config.yaml`.

**Assert**

- Doctor output reports Codex as missing or unavailable.
- Output gives actionable remediation text.
- CLI exits with code `4` if missing required providers cause doctor failure.
- Secrets are not printed.

---

### TC-10.02 — Doctor reports missing Gemini CLI

**Type:** Integration

**Arrange**

- Run tests with PATH modified so `gemini` is unavailable.
- Configure provider `gemini` in config.

**Act**

- Run `execflow doctor`.

**Assert**

- Doctor output reports Gemini as missing or unavailable.
- CLI exits with code `4` if missing required providers cause doctor failure.
- No credentials or secret-like environment values are printed.

---

### TC-10.03 — Doctor succeeds with mock provider only

**Type:** Integration

**Arrange**

- Configure only `mock` provider or make mock the default provider.
- Ensure no real provider CLIs are required.

**Act**

- Run `execflow doctor`.

**Assert**

- CLI exits with code `0`.
- Output reports mock provider as available.
- Test passes in CI without real provider credentials.

---

## 15. AC-11 — Documented exit codes

### TC-11.01 — Success returns exit code 0

**Type:** Integration

**Arrange**

- Prepare valid workflow with successful mock provider.

**Act**

- Run `execflow run workflow.js --provider mock`.

**Assert**

- Process exit code is `0`.
- Final report status is `succeeded`.

---

### TC-11.02 — Workflow failure returns exit code 1

**Type:** Integration

**Arrange**

- Create workflow that throws an error after validation succeeds.

**Act**

- Run workflow.

**Assert**

- Process exit code is `1`.
- Final report status is `failed`.
- Error code is present in final report.

---

### TC-11.03 — Invalid CLI usage returns exit code 2

**Type:** Integration

**Arrange**

- Use unsupported flag or missing required workflow argument.

**Act**

- Run `execflow run --bad-flag` or `execflow run` without workflow file.

**Assert**

- Process exit code is `2`.
- Error code is `CLI_USAGE_ERROR`.
- Usage help is displayed.

---

### TC-11.04 — Parse or validation error returns exit code 3

**Type:** Integration

**Arrange**

- Use invalid workflow metadata or invalid syntax.

**Act**

- Run `execflow validate invalid.workflow.js`.

**Assert**

- Process exit code is `3`.
- Error code is `WORKFLOW_PARSE_ERROR` or `WORKFLOW_VALIDATION_ERROR`.

---

### TC-11.05 — Provider unavailable returns exit code 4

**Type:** Integration

**Arrange**

- Use provider `codex` with PATH modified so command is unavailable.

**Act**

- Run workflow or doctor.

**Assert**

- Process exit code is `4`.
- Error code is `PROVIDER_UNAVAILABLE`.

---

### TC-11.06 — Security violation returns exit code 5

**Type:** Integration

**Arrange**

- Use workflow attempting restricted shell, process, import, or filesystem access.
- Classify the violation as security policy rather than parse validation where applicable.

**Act**

- Run workflow.

**Assert**

- Process exit code is `5` if classified as security policy violation.
- Error code is `SECURITY_POLICY_VIOLATION`.

---

### TC-11.07 — User cancellation returns exit code 6

**Type:** Integration

**Arrange**

- Create long-running mock provider workflow.
- Start `execflow run`.

**Act**

- Send SIGINT or configured abort signal.

**Assert**

- Process exit code is `6`.
- Active process receives cancellation.
- Final report is written when possible.
- Manifest status is `cancelled`.

---

### TC-11.08 — Timeout returns exit code 7 when workflow fails due to timeout

**Type:** Integration

**Arrange**

- Create workflow with a required agent that times out.
- Set short timeout.

**Act**

- Run workflow.

**Assert**

- Process exit code is `7` when timeout causes workflow failure.
- Agent status is `timed_out`.
- Partial logs are preserved.

---

### TC-11.09 — Internal error returns exit code 8

**Type:** Unit / Integration with controlled fault injection

**Arrange**

- Inject an artifact store failure, unexpected runtime exception, or impossible internal state.

**Act**

- Run command under controlled test conditions.

**Assert**

- Process exit code is `8`.
- Error code is `INTERNAL_ERROR` or `ARTIFACT_WRITE_FAILED` depending on classification.
- Error is serialized safely.
- Secrets are redacted.

---

## 16. AC-12 — Default test suite works without real providers

### TC-12.01 — Default CI test suite uses mock provider

**Type:** CI / Integration

**Arrange**

- Run tests in an environment without Codex or Gemini credentials.
- Ensure no real provider CLI is required for default test run.
- Configure mock provider for all default integration tests.

**Act**

- Run default test command, for example:

```bash
pnpm test
```

**Assert**

- Test suite exits with code `0`.
- No test requires OpenAI, Google, Codex, or Gemini credentials by default.
- Real provider tests are skipped unless explicit environment variables or flags are set.

---

### TC-12.02 — Real provider E2E tests are credential-gated

**Type:** CI / E2E

**Arrange**

- Define explicit environment gates such as:
  - `EXECFLOW_E2E_CODEX=1`
  - `EXECFLOW_E2E_GEMINI=1`
- Do not set those gates in default CI.

**Act**

- Run full test suite.

**Assert**

- Codex E2E tests are skipped unless Codex gate is enabled.
- Gemini E2E tests are skipped unless Gemini gate is enabled.
- Skipped tests are reported clearly.
- Default CI remains deterministic.

---

## 17. Cross-Cutting Test Cases

### TC-X.01 — Secrets are redacted from output and artifacts

**Type:** Unit / Integration

**Arrange**

- Set environment variables:
  - `OPENAI_API_KEY=secret-openai`
  - `GEMINI_API_KEY=secret-gemini`
  - `MY_TOKEN=secret-token`
- Configure provider env filtering and redaction.
- Use a mock provider that echoes environment-like strings if allowed by the test harness.

**Act**

- Run workflow.

**Assert**

- Terminal output does not contain raw secret values.
- `events.jsonl` does not contain raw secret values.
- `report.json` does not contain raw secret values.
- Provider command diagnostics redact secret-like values.

---

### TC-X.02 — Config precedence is respected

**Type:** Unit / Integration

**Arrange**

- Config file sets `defaultProvider: mock` and `concurrency: 1`.
- CLI passes `--provider mock --concurrency 2`.
- Agent explicitly sets `provider: "mock"`.

**Act**

- Resolve effective config and run workflow.

**Assert**

- CLI concurrency overrides config concurrency.
- Explicit agent provider is preserved.
- `--provider` sets default provider but does not override explicit per-agent provider.

---

### TC-X.03 — Unsupported MVP flags are rejected clearly

**Type:** Integration

**Arrange**

- Prepare valid workflow.

**Act**

Run each unsupported flag:

```bash
execflow run workflow.js --allow-shell
execflow run workflow.js --isolation worktree
execflow run workflow.js --isolation container
execflow run workflow.js --retry 1
```

**Assert**

- Each command fails with exit code `2` or a documented validation code.
- Error message states that the option is not supported in MVP.
- No provider is invoked.

---

## 18. Minimum Release-Gate Test Matrix

| Area | Required before MVP release |
|---|---|
| CLI | `run`, `validate`, and `doctor` integration tests pass. |
| Workflow validation | Valid metadata passes; missing/dynamic metadata fails; restricted APIs fail. |
| Runtime DSL | `agent`, `parallel`, `phase`, and `log` are exercised end-to-end. |
| Scheduler | Concurrency limit, all-settle behavior, fail-fast, and cancellation are tested. |
| Providers | Mock adapter integration passes; Codex/Gemini command construction and fixture parsing pass. |
| Process runner | stdout/stderr capture, non-zero exit, abort, and timeout are tested. |
| Artifacts | Manifest, events, report, prompt, stdout, stderr, raw result, and normalized result are persisted. |
| Reports | Pretty, JSON, and JSONL reporters produce expected output with no mode corruption. |
| Schema validation | Success and failure paths are tested with artifacts. |
| Exit codes | Codes 0 through 8 are covered by tests or controlled fault injection. |
| CI default | Test suite passes with mock provider and no real provider credentials. |

---

## 19. Recommended Implementation Order for Tests

1. Unit tests for contracts, errors, config, and exit-code mapping.
2. Unit tests for metadata parser and workflow validator.
3. Artifact store and event bus tests.
4. Mock provider adapter tests.
5. Basic `execflow validate` integration tests.
6. Basic `execflow run` mock integration tests.
7. Parallel/concurrency integration tests.
8. Reporter output tests.
9. Timeout and cancellation tests.
10. Schema validation tests.
11. Doctor tests.
12. Codex and Gemini adapter fixture tests.
13. Optional real-provider E2E tests behind explicit gates.

---

## 20. Release Readiness Checklist

- [ ] Every MVP acceptance criterion has at least one passing test.
- [ ] All tests run in a clean temporary working directory.
- [ ] Default tests do not depend on Codex or Gemini credentials.
- [ ] JSON reporter stdout is parseable and contains no progress text.
- [ ] JSONL reporter stdout is parseable line-by-line and ordered.
- [ ] Pretty reporter is visually useful for local runs.
- [ ] Artifacts are preserved after success, failure, timeout, and cancellation.
- [ ] Exit codes match documented behavior.
- [ ] Unsupported MVP features fail clearly.
- [ ] Secrets are redacted from terminal output, reports, events, and logs where feasible.

---

## 21. Notes for Junior Engineers

When writing each test, keep the AAA sections visible in the test code comments:

```ts
it("validates metadata for a valid workflow", async () => {
  // Arrange
  const workflowPath = fixture("workflows/valid-basic.workflow.js");

  // Act
  const result = await execflow(["validate", workflowPath]);

  // Assert
  expect(result.exitCode).toBe(0);
  expect(result.stderr).not.toContain("error");
});
```

Prefer testing observable behavior first:

1. CLI exit code.
2. stdout/stderr contract.
3. final report contents.
4. events JSONL contents.
5. artifact files on disk.
6. internal function calls only when needed for unit-level precision.

