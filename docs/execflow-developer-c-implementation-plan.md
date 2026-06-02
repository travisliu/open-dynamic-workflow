# execflow MVP — Developer C Detailed Implementation Plan

**Owner:** Developer C  
**Audience:** Junior engineers  
**Scope:** Provider registry, mock provider, Codex adapter, Gemini adapter, process runner, structured output validation, provider health checks, environment filtering support  
**Date:** 2026-06-02

---

## 1. What Developer C owns

Developer C owns the code that turns an `agent()` request into either:

1. a deterministic mock response for tests, or
2. a provider CLI invocation, such as `codex exec` or `gemini -p`, or
3. a structured failure result when the provider fails, times out, is missing, or returns invalid schema output.

Developer C should **not** implement the workflow runtime, scheduler, CLI parser, reporters, or artifact store. Those are owned by other developers. Developer C must build clean interfaces that those other parts can call.

---

## 2. MVP boundaries for Developer C

### Included

Developer C must implement:

- Provider registry.
- Mock adapter.
- Codex adapter.
- Gemini adapter.
- Provider-independent process runner.
- Timeout and abort support in the process runner.
- stdout and stderr capture.
- Provider command construction.
- Defensive provider output parsing.
- JSON extraction from provider output.
- JSON Schema validation.
- Schema validation failure result creation.
- Provider health checks for `execflow doctor`.
- Environment allowlist and secret redaction helper functions.
- Unit tests and fixture tests.

### Excluded

Developer C must **not** implement:

- Workflow parsing.
- Workflow validation.
- Scheduler concurrency logic.
- `parallel()` behavior.
- Event bus sequencing.
- Pretty, JSON, or JSONL reporters.
- Artifact directory creation.
- Retry policies.
- Provider-level concurrency limits.
- Provider plugin loading.
- Worktree or container isolation.
- Automatic patch application.

Leave hooks for these features, but do not implement them in MVP.

---

## 3. Key design rules

Follow these rules throughout the implementation:

1. **Adapters are small.** They build provider commands and parse output. They do not decide global workflow success.
2. **The process runner is provider-agnostic.** It knows nothing about Codex, Gemini, or mock behavior.
3. **Structured validation is local.** Provider-native JSON can be used, but execflow must validate it itself.
4. **Raw output is always preserved.** Even if parsing fails, stdout and stderr must be available for artifacts.
5. **Mock provider is mandatory.** Tests must pass without Codex or Gemini installed.
6. **Missing provider is a normal error case.** It should produce a clear health result or failure, not an unclear crash.
7. **No secrets in logs.** Do not print raw environment variables or command objects that may contain secrets.

---

## 4. Files Developer C should create or edit

This section lists each file, why it exists, and what should go into it.

### 4.1 `src/agents/types.ts`

**Purpose:** Shared TypeScript contracts for provider adapters and process execution.

**Create or edit:** Create if it does not exist. If Dev A or Dev B already created shared contracts elsewhere, import from those contracts instead of duplicating types.

**Add these types:**

```ts
export type ProviderName = "mock" | "codex" | "gemini" | string;

export type AgentStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "skipped";

export type JsonSchema = Record<string, unknown>;

export interface AgentRunInput {
  id: string;
  label?: string;
  provider: ProviderName;
  prompt: string;
  cwd: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs: number;
  env: Record<string, string>;
  metadata?: Record<string, unknown>;
}

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

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: unknown;
}

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

export type AgentResult = AgentSuccessResult | AgentFailureResult;

export interface ProviderCommand {
  command: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env: Record<string, string>;
}

export interface ProviderParsedResult {
  text?: string;
  json?: unknown;
  raw?: unknown;
  parseWarnings?: string[];
}

export interface ProviderParseInput {
  input: AgentRunInput;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ProviderHealth {
  provider: string;
  available: boolean;
  command?: string;
  version?: string;
  message?: string;
  error?: SerializedError;
}

export interface AgentAdapter {
  name: string;
  checkHealth?(): Promise<ProviderHealth>;
  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;
  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}

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

**Junior engineer notes:**

- Keep this file boring and stable.
- Do not put implementation logic here.
- Avoid importing concrete adapter classes here to prevent circular imports.

**Tests:** Type-only compile checks are enough for this file.

---

### 4.2 `src/agents/registry.ts`

**Purpose:** Register and resolve provider adapters by name.

**Create or edit:** Create.

**Responsibilities:**

- Register built-in adapters: `mock`, `codex`, `gemini`.
- Return the adapter for a provider name.
- Return a clear error when the provider is unknown.
- Expose a `listProviders()` helper for `doctor`.

**Suggested shape:**

```ts
import type { AgentAdapter } from "./types";

export class ProviderRegistry {
  private readonly adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Provider adapter already registered: ${adapter.name}`);
    }
    this.adapters.set(adapter.name, adapter);
  }

  get(provider: string): AgentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    return adapter;
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }
}
```

**Add helper:**

```ts
export function createDefaultProviderRegistry(deps: RegistryDeps): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new MockAdapter(deps.mockConfig));
  registry.register(new CodexExecAdapter(deps.config.providers.codex));
  registry.register(new GeminiCliAdapter(deps.config.providers.gemini));
  return registry;
}
```

**Junior engineer notes:**

- Do not make the registry read the config file directly. Dev A owns config loading.
- The registry receives already-resolved config.
- Throwing for duplicate registration is useful because it catches setup bugs early.

**Tests:**

- registers an adapter
- resolves an adapter by name
- rejects duplicate adapter names
- throws clear error for unknown provider
- default registry contains `mock`, `codex`, and `gemini`

---

### 4.3 `src/agents/mock-adapter.ts`

**Purpose:** Deterministic provider for tests, examples, and CI.

**Create or edit:** Create.

**Responsibilities:**

- Never spawn a real process.
- Return configured text or JSON.
- Simulate failure when configured.
- Simulate delay when configured.
- Support lookup by `input.id`, then `input.label`, then `default`.

**Suggested config type:**

```ts
export interface MockProviderConfig {
  responses?: Record<string, MockResponse>;
}

export type MockResponse =
  | { text: string; delayMs?: number }
  | { json: unknown; delayMs?: number }
  | { error: { message: string; code?: string }; delayMs?: number };
```

**Lookup rule:**

```text
1. responses[input.id]
2. responses[input.label]
3. responses.default
4. fallback text: "mock response"
```

**Adapter behavior:**

- `checkHealth()` always returns available.
- `buildCommand()` can return a fake command object for debugging, but no process should be spawned for mock.
- `parseResult()` can simply return the configured result.

**Important integration decision:**

There are two acceptable MVP approaches:

1. Give mock adapter a special `runMock()` method and let the agent execution service bypass the process runner for mock.
2. Make the mock adapter implement `buildCommand()` with a Node inline command.

Choose **option 1** if the team allows it. It is easier to test and avoids fake subprocess complexity.

**Junior engineer notes:**

- Mock behavior must be deterministic. Do not use randomness.
- Do not require Codex or Gemini credentials for tests.
- A mock failure should look like a real `AgentFailureResult` later in the agent execution path.

**Tests:**

- default mock text response
- mock text response by id
- mock JSON response by id
- mock response by label
- configured mock failure
- configured delay
- health check is always available

---

### 4.4 `src/agents/process-runner.ts`

**Purpose:** Spawn provider CLI processes and capture output safely.

**Create or edit:** Create.

**Responsibilities:**

- Spawn a child process with `command`, `args`, `cwd`, `stdin`, and `env`.
- Stream stdout and stderr to callbacks.
- Accumulate stdout and stderr strings.
- Enforce `timeoutMs`.
- Support `AbortSignal` cancellation.
- Return `exitCode`, `signal`, `stdout`, `stderr`, `durationMs`, `timedOut`, and `cancelled`.
- Avoid logging raw env values.

**Suggested implementation steps:**

1. Use Node `child_process.spawn`.
2. Record `startedAt = Date.now()`.
3. Start a timeout with `setTimeout`.
4. When stdout data arrives:
   - convert Buffer to string
   - append to `stdout`
   - call `onStdout(chunk)`
5. When stderr data arrives:
   - convert Buffer to string
   - append to `stderr`
   - call `onStderr(chunk)`
6. If `stdin` exists, write it to `child.stdin` and end stdin.
7. If timeout fires, set `timedOut = true` and terminate the child process.
8. If abort signal fires, set `cancelled = true` and terminate the child process.
9. Resolve on `close`.
10. Reject only on spawn setup errors that prevent starting the process.

**Termination behavior:**

```text
1. Send SIGTERM.
2. Wait a short grace period, such as 2 seconds.
3. If still running, send SIGKILL.
```

**Windows note:**

Process-tree termination differs across operating systems. For MVP, implement best effort:

- use `child.kill("SIGTERM")`
- then `child.kill("SIGKILL")`
- keep a TODO for stronger cross-platform tree killing if needed

**Junior engineer notes:**

- Do not throw when a process exits with a non-zero code. Return the result and let the caller convert it to an agent failure.
- Do throw when the process cannot be spawned, because there is no useful stdout/stderr result.
- Always clear timers and event listeners before resolving.
- Keep stdout/stderr callbacks best-effort. If a callback throws, catch it and continue.

**Tests:**

- captures stdout
- captures stderr
- returns non-zero exit code
- passes stdin
- times out long-running process
- handles abort signal
- reports duration
- does not throw on non-zero exit
- throws clear error when command is missing

---

### 4.5 `src/agents/codex-exec.ts`

**Purpose:** Build and parse Codex CLI invocations.

**Create or edit:** Create.

**Responsibilities:**

- Implement `AgentAdapter` for provider name `codex`.
- Build a configurable `codex exec` command.
- Prefer prompt via stdin when configured.
- Include configured static args from config.
- Include model argument if configured and supported by config.
- Parse JSON output when possible.
- Fall back to text output.
- Implement provider health check.

**Suggested provider config:**

```ts
export interface CodexProviderConfig {
  command?: string; // default: "codex"
  args?: string[];  // default: ["exec", "--json", "--ephemeral"]
  defaultModel?: string | null;
  promptMode?: "stdin" | "arg";
}
```

**Command-building rules:**

```text
command = config.command ?? "codex"
args = config.args ?? ["exec", "--json", "--ephemeral"]
if input.model exists, append configured model args if supported
if promptMode is "stdin", set stdin to input.prompt and append "-" only if config expects it
if promptMode is "arg", append input.prompt as an argument
cwd = input.cwd
stdin = input.prompt when promptMode is "stdin"
env = input.env
```

**Parsing rules:**

1. Try to parse stdout as JSON.
2. If JSON parses and looks like `{ text: ... }`, return `text`.
3. If JSON parses and looks like arbitrary object, return `json` and `raw`.
4. If JSON parsing fails, return stdout as `text` and include a parse warning.
5. Never discard raw stdout or stderr.

**Health check:**

- Run a cheap process such as `codex --version` or `codex exec --help`.
- If command is missing, return `available: false` with a clear message.
- Do not require model credentials for the health check if avoidable.

**Junior engineer notes:**

- The exact Codex CLI flags may change. That is why command and args must be configurable.
- Do not hard-code provider behavior into workflow runtime.
- Keep parsing defensive. Provider output can change.

**Tests:**

- builds default command
- builds command with configured static args
- uses stdin prompt mode
- supports configured model argument, if implemented
- parses JSON stdout
- falls back to text stdout
- records parse warning for malformed JSON
- health check reports missing command clearly

---

### 4.6 `src/agents/gemini-cli.ts`

**Purpose:** Build and parse Gemini CLI invocations.

**Create or edit:** Create.

**Responsibilities:**

- Implement `AgentAdapter` for provider name `gemini`.
- Build configurable `gemini -p` commands.
- Support configured output format.
- Support configured model argument.
- Parse JSON output when possible.
- Fall back to text output.
- Implement provider health check.

**Suggested provider config:**

```ts
export interface GeminiProviderConfig {
  command?: string; // default: "gemini"
  args?: string[];  // default: ["--output-format", "json"]
  defaultModel?: string | null;
  promptFlag?: string; // default: "-p"
  modelFlag?: string;  // default: "-m"
}
```

**Command-building rules:**

```text
command = config.command ?? "gemini"
args = []
append prompt flag: "-p"
append input.prompt
append config args, such as "--output-format", "json"
if model exists, append model flag and model value
cwd = input.cwd
env = input.env
```

**Parsing rules:**

1. Try to parse stdout as JSON.
2. If the parsed JSON has a known text field, return `text`.
3. If the parsed JSON is an object or array, return it as `json`.
4. If parsing fails, return stdout as `text` with a parse warning.
5. Keep stderr unchanged for artifacts.

**Health check:**

- Run `gemini --version` or `gemini --help`.
- Return `available: false` for missing executable.
- Do not print environment variables.

**Junior engineer notes:**

- Put provider-specific assumptions in this file only.
- Do not make scheduler or runtime understand Gemini output.
- Keep command flags configurable so the CLI can evolve.

**Tests:**

- builds default command
- builds command with configured output format
- includes model argument when model is set
- parses JSON stdout
- falls back to text stdout
- records parse warning for malformed JSON
- health check reports missing command clearly

---

### 4.7 `src/agents/execute-agent.ts`

**Purpose:** Optional integration helper that combines registry, adapter, process runner, artifact callbacks, and schema validation into one function.

**Create or edit:** Create only if Dev B wants Developer C to provide this helper. Otherwise Dev B may own this orchestration.

**Responsibilities:**

- Receive `AgentRunInput`.
- Resolve adapter from provider registry.
- For mock adapter, produce deterministic result without process runner.
- For real providers:
  - call `adapter.buildCommand()`
  - call `runProcess()`
  - stream stdout/stderr through callbacks provided by Dev D
  - call `adapter.parseResult()`
  - normalize output
  - run schema validation if needed
  - return `AgentSuccessResult` or `AgentFailureResult`

**Do not do:**

- Do not create artifact directories.
- Do not decide whether the whole workflow failed.
- Do not emit scheduler lifecycle events directly unless Dev B and Dev D define that interface.

**Junior engineer notes:**

- This file is a coordinator. Keep it thin.
- If it gets too large, split helpers into `build-agent-result.ts` and `normalize-agent-output.ts`.

**Tests:**

- successful mock result
- failed mock result
- provider non-zero exit becomes `AgentFailureResult`
- timeout becomes `timed_out`
- cancellation becomes `cancelled`
- schema validation failure becomes `AgentFailureResult`

---

### 4.8 `src/structured/extract-json.ts`

**Purpose:** Find JSON in provider output.

**Create or edit:** Create.

**Responsibilities:**

- Try direct `JSON.parse(stdout)` first.
- If direct parse fails, find the first fenced JSON code block.
- If fenced block fails, find the first balanced JSON object or array.
- Return either parsed JSON or a clear failure.

**Suggested return type:**

```ts
export interface ExtractJsonSuccess {
  ok: true;
  value: unknown;
  source: "direct" | "fenced" | "balanced";
}

export interface ExtractJsonFailure {
  ok: false;
  error: string;
}

export type ExtractJsonResult = ExtractJsonSuccess | ExtractJsonFailure;
```

**Implementation tips:**

- Start simple. Direct parse and fenced-code-block extraction are enough for the first version.
- Add balanced object extraction only if needed for tests.
- Avoid unsafe `eval`.

**Junior engineer notes:**

- This function should be pure: same input, same output, no file system, no process calls.
- Add many small tests. JSON extraction bugs are common.

**Tests:**

- parses direct JSON object
- parses direct JSON array
- parses fenced ```json block
- fails clearly for malformed JSON
- ignores normal text when no JSON exists

---

### 4.9 `src/structured/validate-json.ts`

**Purpose:** Validate extracted JSON against a JSON Schema.

**Create or edit:** Create.

**Recommended dependency:** `ajv`

**Responsibilities:**

- Compile the schema.
- Validate the candidate JSON value.
- Return success with the value when valid.
- Return failure with readable validation errors when invalid.

**Suggested return type:**

```ts
export interface JsonValidationSuccess {
  ok: true;
  value: unknown;
}

export interface JsonValidationFailure {
  ok: false;
  code: "SCHEMA_VALIDATION_FAILED";
  message: string;
  errors: unknown[];
}

export type JsonValidationResult = JsonValidationSuccess | JsonValidationFailure;
```

**Junior engineer notes:**

- Do not throw for normal validation failures. Return a failure object.
- Throw only when the schema itself is invalid and cannot be compiled.
- Keep validation error messages useful for humans.

**Tests:**

- validates correct object
- rejects missing required field
- rejects wrong type
- handles invalid schema clearly
- produces `SCHEMA_VALIDATION_FAILED`

---

### 4.10 `src/structured/normalize-agent-output.ts`

**Purpose:** Apply the MVP normalization order.

**Create or edit:** Create.

**Responsibilities:**

For an agent call with a schema:

1. Use `ProviderParsedResult.json` if available.
2. Otherwise use JSON output parsed by the adapter if available.
3. Otherwise extract first valid JSON from stdout.
4. Validate the result against schema.
5. Return success or schema validation failure.

For an agent call without a schema:

1. Prefer `ProviderParsedResult.text`.
2. If text is missing but JSON exists, expose JSON.
3. Fall back to raw stdout as text.

**Suggested function:**

```ts
export async function normalizeAgentOutput(input: {
  schema?: JsonSchema;
  parsed: ProviderParsedResult;
  stdout: string;
}): Promise<NormalizedOutputResult> {
  // implement normalization order
}
```

**Junior engineer notes:**

- This is where schema logic belongs, not inside Codex or Gemini adapters.
- Provider adapters parse candidates; this module decides whether the candidate is valid.

**Tests:**

- schema uses provider JSON
- schema extracts JSON from stdout
- schema failure when no JSON exists
- schema failure when JSON shape is invalid
- no-schema text fallback
- no-schema JSON fallback

---

### 4.11 `src/security/env.ts`

**Purpose:** Filter and redact environment variables before passing them to providers or writing logs.

**Create or edit:** Create if Dev A has not already created it. If Dev A owns config/security, coordinate to avoid duplicate helpers.

**Responsibilities:**

- Build provider environment using an allowlist.
- Support required base variables such as `PATH`, `HOME`, and platform-specific process variables if needed.
- Redact known secret-like values before logs or artifacts.
- Support patterns:
  - `*_KEY`
  - `*_TOKEN`
  - `*_SECRET`
  - `PASSWORD`
  - `OPENAI_API_KEY`
  - `GEMINI_API_KEY`
  - `GOOGLE_API_KEY`

**Suggested functions:**

```ts
export function buildProviderEnv(input: {
  baseEnv: NodeJS.ProcessEnv;
  passEnv: string[];
  explicitEnv?: Record<string, string>;
}): Record<string, string>;

export function redactText(input: string, secretValues: string[]): string;

export function shouldRedactEnvName(name: string, patterns: string[]): boolean;
```

**Junior engineer notes:**

- Do not pass the full `process.env` to providers by default.
- Do not print env objects in thrown errors.
- Redaction should be best effort; document limitations.

**Tests:**

- allowlisted env is passed
- non-allowlisted env is not passed
- explicit provider env is included when allowed by config
- secret-looking names are redacted
- secret values in text are replaced with `[REDACTED]`

---

### 4.12 `src/cli/commands/doctor.ts`

**Purpose:** Developer C contributes provider checks; Dev A owns the command shell.

**Create or edit:** Edit only the provider-related section, in coordination with Dev A.

**Responsibilities for Developer C:**

- Provide a function that Dev A can call:

```ts
export async function checkProviderHealth(registry: ProviderRegistry): Promise<ProviderHealth[]>;
```

- Run health checks for `mock`, `codex`, and `gemini`.
- Return structured results, not formatted terminal strings.

**Junior engineer notes:**

- The adapter should report health. The CLI command should format it.
- Do not call `console.log` from provider adapters.

**Tests:**

- mock health is available
- missing Codex returns unavailable
- missing Gemini returns unavailable
- health function does not throw when one provider is missing

---

## 5. Suggested test files

Create tests in these locations unless the project has a different convention.

```text
tests/unit/agents/registry.test.ts
tests/unit/agents/mock-adapter.test.ts
tests/unit/agents/process-runner.test.ts
tests/unit/agents/codex-exec.test.ts
tests/unit/agents/gemini-cli.test.ts
tests/unit/structured/extract-json.test.ts
tests/unit/structured/validate-json.test.ts
tests/unit/structured/normalize-agent-output.test.ts
tests/unit/security/env.test.ts
tests/fixtures/providers/codex-json-stdout.txt
tests/fixtures/providers/codex-text-stdout.txt
tests/fixtures/providers/codex-malformed-json.txt
tests/fixtures/providers/gemini-json-stdout.txt
tests/fixtures/providers/gemini-text-stdout.txt
tests/fixtures/providers/gemini-malformed-json.txt
```

---

## 6. Implementation order

Follow this order to avoid getting blocked.

### Step 1: Add shared types

Files:

```text
src/agents/types.ts
```

Done when:

- TypeScript compiles.
- Other Developer C files can import the contracts.

---

### Step 2: Implement provider registry

Files:

```text
src/agents/registry.ts
tests/unit/agents/registry.test.ts
```

Done when:

- Adapters can be registered.
- Adapters can be resolved by name.
- Unknown providers produce a clear error.

---

### Step 3: Implement mock adapter

Files:

```text
src/agents/mock-adapter.ts
tests/unit/agents/mock-adapter.test.ts
```

Done when:

- Mock text responses work.
- Mock JSON responses work.
- Mock failures work.
- Tests do not require real provider CLIs.

---

### Step 4: Implement process runner

Files:

```text
src/agents/process-runner.ts
tests/unit/agents/process-runner.test.ts
```

Done when:

- stdout is captured.
- stderr is captured.
- stdin is passed.
- non-zero exits are returned, not thrown.
- timeouts terminate the process.
- abort signals terminate the process.

---

### Step 5: Implement structured output helpers

Files:

```text
src/structured/extract-json.ts
src/structured/validate-json.ts
src/structured/normalize-agent-output.ts
tests/unit/structured/extract-json.test.ts
tests/unit/structured/validate-json.test.ts
tests/unit/structured/normalize-agent-output.test.ts
```

Done when:

- JSON can be extracted from direct JSON stdout.
- JSON can be extracted from fenced JSON blocks.
- valid schema output succeeds.
- invalid schema output returns `SCHEMA_VALIDATION_FAILED`.

---

### Step 6: Implement Codex adapter

Files:

```text
src/agents/codex-exec.ts
tests/unit/agents/codex-exec.test.ts
tests/fixtures/providers/codex-json-stdout.txt
tests/fixtures/providers/codex-text-stdout.txt
tests/fixtures/providers/codex-malformed-json.txt
```

Done when:

- default command is built correctly.
- configured command args are respected.
- prompt can be passed through stdin.
- JSON stdout can be parsed.
- text stdout fallback works.
- malformed JSON does not crash parsing.

---

### Step 7: Implement Gemini adapter

Files:

```text
src/agents/gemini-cli.ts
tests/unit/agents/gemini-cli.test.ts
tests/fixtures/providers/gemini-json-stdout.txt
tests/fixtures/providers/gemini-text-stdout.txt
tests/fixtures/providers/gemini-malformed-json.txt
```

Done when:

- default command is built correctly.
- configured output format is respected.
- model argument is supported.
- JSON stdout can be parsed.
- text stdout fallback works.
- malformed JSON does not crash parsing.

---

### Step 8: Implement environment filtering and redaction

Files:

```text
src/security/env.ts
tests/unit/security/env.test.ts
```

Done when:

- env allowlist works.
- secret-looking names are redacted.
- known secret values in strings are redacted.
- provider process env does not default to full `process.env`.

---

### Step 9: Add provider health check integration

Files:

```text
src/agents/provider-health.ts
src/cli/commands/doctor.ts
```

Developer C may own `provider-health.ts`; Dev A likely owns `doctor.ts` formatting.

Done when:

- `mock` reports available.
- missing Codex reports unavailable.
- missing Gemini reports unavailable.
- one missing provider does not prevent other checks from running.

---

### Step 10: Integrate with runtime/scheduler owner

Files may include:

```text
src/agents/execute-agent.ts
src/orchestration/scheduler.ts
src/workflow/dsl.ts
src/artifacts/run-store.ts
```

Developer C should pair with Dev B and Dev D here.

Done when:

- scheduler can call provider registry.
- process stdout/stderr callbacks are connected to artifact/event hooks.
- final `AgentResult` shape matches contract.
- mock workflow can run end-to-end.

---

## 7. Junior-friendly implementation checklist

Before opening a pull request, check the following:

- [ ] I did not add provider-specific logic to runtime or scheduler.
- [ ] I did not make adapters decide workflow success or failure.
- [ ] I did not make process runner parse provider output.
- [ ] I did not throw for normal provider non-zero exit.
- [ ] I preserved stdout and stderr on failure.
- [ ] I added tests for success and failure paths.
- [ ] I added malformed output tests.
- [ ] I added missing executable health tests.
- [ ] I did not print raw env values.
- [ ] I did not require real Codex or Gemini credentials for the default test suite.
- [ ] I kept retry behavior out of MVP.
- [ ] I kept provider-level concurrency out of MVP.

---

## 8. Pull request sequence

Developer C should split work into small pull requests.

### PR 1: Agent contracts and registry

Files:

```text
src/agents/types.ts
src/agents/registry.ts
tests/unit/agents/registry.test.ts
```

Review focus:

- Are types aligned with shared contracts?
- Does registry avoid config loading?
- Are error messages clear?

---

### PR 2: Mock adapter

Files:

```text
src/agents/mock-adapter.ts
tests/unit/agents/mock-adapter.test.ts
```

Review focus:

- Is behavior deterministic?
- Can tests run without real providers?
- Does mock support text, JSON, failure, and delay?

---

### PR 3: Process runner

Files:

```text
src/agents/process-runner.ts
tests/unit/agents/process-runner.test.ts
```

Review focus:

- Are timeout and abort reliable?
- Are stdout and stderr streamed and accumulated?
- Are timers and listeners cleaned up?

---

### PR 4: Structured output validation

Files:

```text
src/structured/extract-json.ts
src/structured/validate-json.ts
src/structured/normalize-agent-output.ts
tests/unit/structured/*.test.ts
```

Review focus:

- Is normalization order correct?
- Are validation failures returned instead of thrown?
- Are error messages useful?

---

### PR 5: Codex adapter

Files:

```text
src/agents/codex-exec.ts
tests/unit/agents/codex-exec.test.ts
tests/fixtures/providers/codex-*.txt
```

Review focus:

- Are command and args configurable?
- Is prompt handling correct?
- Is parsing defensive?

---

### PR 6: Gemini adapter

Files:

```text
src/agents/gemini-cli.ts
tests/unit/agents/gemini-cli.test.ts
tests/fixtures/providers/gemini-*.txt
```

Review focus:

- Are command and flags configurable?
- Is model support correct?
- Is parsing defensive?

---

### PR 7: Health checks and env filtering

Files:

```text
src/agents/provider-health.ts
src/security/env.ts
src/cli/commands/doctor.ts
tests/unit/security/env.test.ts
tests/unit/agents/provider-health.test.ts
```

Review focus:

- Are missing providers handled cleanly?
- Is env allowlisting enforced?
- Are secrets redacted before logs/artifacts?

---

## 9. Expected acceptance criteria for Developer C

Developer C is done when:

1. The mock adapter can produce deterministic text, JSON, failure, and delayed responses.
2. The process runner captures stdout and stderr and supports timeout and cancellation.
3. Codex command construction is covered by tests.
4. Gemini command construction is covered by tests.
5. Codex and Gemini parsing handles text, JSON, malformed JSON, and non-zero exit fixtures.
6. Structured output validation succeeds for valid JSON.
7. Structured output validation returns `SCHEMA_VALIDATION_FAILED` for invalid JSON shape.
8. Missing Codex and Gemini executables are reported clearly through health checks.
9. The default test suite does not require real provider credentials.
10. No provider-specific details leak into workflow runtime behavior.

---

## 10. Useful local commands

Adjust these commands to match the final package scripts.

```bash
pnpm install
pnpm test tests/unit/agents/registry.test.ts
pnpm test tests/unit/agents/mock-adapter.test.ts
pnpm test tests/unit/agents/process-runner.test.ts
pnpm test tests/unit/structured/extract-json.test.ts
pnpm test tests/unit/structured/validate-json.test.ts
pnpm test tests/unit/agents/codex-exec.test.ts
pnpm test tests/unit/agents/gemini-cli.test.ts
pnpm test
pnpm lint
pnpm typecheck
```

---

## 11. Common mistakes to avoid

### Mistake 1: Making adapters run processes directly

Do not do this:

```ts
// Bad
class CodexAdapter {
  async run() {
    return spawn("codex", ["exec"]);
  }
}
```

Do this instead:

```ts
// Good
class CodexAdapter {
  async buildCommand(input) {
    return { command: "codex", args: ["exec", "--json"], stdin: input.prompt };
  }
}
```

The process runner owns process execution.

---

### Mistake 2: Throwing on provider failure

Do not throw just because the provider exits non-zero. Return a structured failed agent result later in the execution path.

---

### Mistake 3: Putting schema validation inside Codex or Gemini adapter

Codex and Gemini adapters can parse candidate JSON, but final schema validation belongs in `src/structured/`.

---

### Mistake 4: Passing all environment variables to providers

Do not pass `process.env` directly. Use allowlisting and redaction helpers.

---

### Mistake 5: Requiring real providers for unit tests

Provider adapter tests should use fixture stdout/stderr and command construction tests. Real provider E2E tests should be optional and credential-gated.

---

## 12. Final handoff checklist

At handoff, Developer C should provide:

- [ ] Summary of implemented files.
- [ ] List of provider config fields supported.
- [ ] Known limitations of Codex parsing.
- [ ] Known limitations of Gemini parsing.
- [ ] Notes on health check commands used.
- [ ] Example mock provider config.
- [ ] Fixture list and what each fixture covers.
- [ ] Confirmation that default tests pass without credentials.
- [ ] Confirmation that timeout and cancellation tests pass.
- [ ] Confirmation that schema validation failure creates the expected error code.

