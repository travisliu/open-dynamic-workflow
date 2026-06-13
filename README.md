# OpenFlow CLI

OpenFlow is a local-first command-line workflow runner for orchestrating coding-agent CLIs such as `codex exec` and `gemini -p`.

It lets engineers define constrained JavaScript-like workflows, run agent tasks sequentially or in parallel, capture structured results, and persist durable run artifacts for local debugging and CI automation.

![OpenFlow](images/demo.png)

---

## Why OpenFlow?

Modern coding agents are useful from the terminal, but larger engineering tasks often need more than one prompt or one agent run. OpenFlow provides a small orchestration layer around external coding-agent CLIs so you can:

- Split large engineering tasks into repeatable workflow files.
- Run multiple agent reviews in parallel.
- Use different providers for different tasks.
- Validate structured JSON output with JSON Schema.
- Capture prompts, stdout, stderr, normalized results, reports, and events.
- Use pretty terminal output locally or JSON/JSONL output in CI.
- Keep provider-specific details out of workflow logic.

OpenFlow does **not** implement its own coding agent. It coordinates external provider CLIs.

---

## Features

OpenFlow supports:

- `openflow run <workflow-file>`
- `openflow validate <workflow-file>`
- `openflow doctor`
- Constrained workflow metadata parsing
- Workflow DSL functions:
  - `agent()`
  - `parallel()`
  - `pipeline()`
  - `workflow()`
  - `tool()`
  - `phase()`
  - `log()`
- Provider adapters:
  - `mock`
  - `codex`
  - `gemini`
  - `opencode`
  - `antigravity`
  - `pi`
- Global concurrency limits
- Timeout handling
- Fail-fast mode
- JSON Schema validation for structured agent output
- Pretty, JSON, and JSONL reporters
- Durable artifact directories under `.openflow/runs/<runId>`
- Resume/cache for unchanged agent-call prefixes
- Deterministic exit codes

Future roadmap features include plugin providers, retries, worktree/container isolation, approval gates, automatic patch application, and static HTML reports.

---

## Requirements

OpenFlow is designed for Node.js-based projects and local or CI environments.

Recommended baseline:

- Node.js 20+
- npm, pnpm, or yarn
- Git, when running inside a repository
- Optional provider CLIs:
  - Codex CLI for the `codex` provider
  - Gemini CLI for the `gemini` provider
  - OpenCode CLI for the `opencode` provider
  - Antigravity CLI for the `antigravity` provider
  - Pi Coding Agent for the `pi` provider

The `mock` provider is intended for tests, examples, and CI workflows that should not require real provider credentials.

---

## Installation & Usage

### Usage with npx

Run without installing globally:

```bash
npx @prmflow/openflow --help
npx @prmflow/openflow doctor
npx @prmflow/openflow validate workflows/review.ts
npx @prmflow/openflow run workflows/review.ts
```

### Global installation

```bash
npm install -g @prmflow/openflow
openflow --help
openflow doctor
```

### Local development

```bash
npm install
npm run build
npx . --help
npx . run workflows/review.ts
```

### Local package smoke test

```bash
npm pack
npx ./prmflow-openflow-0.2.0.tgz --help
npx ./prmflow-openflow-0.2.0.tgz doctor
```

---

## Quick Start

Create a workflow file:

```ts
// workflows/review.ts
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

Run it:

```bash
openflow run workflows/review.ts
```

Validate it without invoking providers:

```bash
openflow validate workflows/review.ts
```

Run a dry run:

```bash
openflow run workflows/review.ts --dry-run
```

---

## Using the Mock Provider

The mock provider is useful for local examples, tests, and CI jobs that should not call external model providers.

```ts
// workflows/mock-review.ts
export const meta = {
  name: "mock-review",
  description: "Example workflow using the mock provider"
};

phase("review");

const result = await agent({
  id: "mock-review",
  provider: "mock",
  prompt: "Review the changed files."
});

export default result;
```

Run:

```bash
openflow run workflows/mock-review.ts --provider mock
```

---

## CLI Commands

### `openflow run`

Runs a workflow file.

```bash
openflow run <workflow-file> [options]
```

Common options:

```bash
--provider <codex|gemini|mock>
--arg key=value
--config <path>
--cwd <path>
--out <path>
--report <pretty|json|jsonl>
--concurrency <number>
--timeout-ms <number>
--resume <runId-or-path>
--no-cache
--dry-run
--fail-fast
--verbose
```

Examples:

```bash
openflow run workflows/review.ts
openflow run workflows/review.ts --provider codex
openflow run workflows/review.ts --concurrency 2
openflow run workflows/review.ts --timeout-ms 600000
openflow run workflows/review.ts --report json
openflow run workflows/review.ts --report jsonl
openflow run workflows/review.ts --fail-fast
openflow run workflows/review.ts --resume <previous-run-id>
```

### `openflow resume`

Runs a new workflow attempt from a previous run's recorded invocation and reuses cached agent results for the longest unchanged prefix.

```bash
openflow resume <runId-or-path> [--out <runs-dir>] [--report <pretty|json|jsonl>] [--no-cache]
```

Resume/cache is intentionally conservative. OpenFlow replays the workflow script and compares each `agent()` call in order. A cached result is reused only while the prefix is unchanged: the call sequence must match, `id` or `label` must match when present, and the call fingerprint must match. The fingerprint includes the prompt, schema, structured-output mode, provider, resolved model, timeout, cwd, metadata, and provider config. After the first miss, later agents run live even if their individual fingerprint matches an older entry.

Use stable `id` values for loops, such as `id: \`round-${i}\``. `Date.now()`, `Math.random()`, and argument-free `new Date()` are rejected because they break deterministic replay.

`--no-cache` disables cache reads and cache-index updates, but still writes `calls.jsonl` for audit/debugging.

### `openflow validate`

Validates workflow metadata, syntax, and restricted behavior.

```bash
openflow validate <workflow-file>
```

Example:

```bash
openflow validate workflows/review.ts
```

Validation checks include:

- `meta` is the first top-level statement.
- `meta.name` and `meta.description` are present.
- Metadata is statically analyzable.
- Unsupported imports and restricted APIs are rejected.
- `pipeline()` stage configuration and structure are verified.

### `openflow doctor`

Checks local environment readiness.

```bash
openflow doctor
```

Typical checks:

- Config file can be loaded.
- Provider CLIs are present when configured.
- `codex` is available for Codex workflows.
- `gemini` is available for Gemini workflows.
- Required provider commands can be executed.
- Secret-like environment values are not printed.

---

## Workflow Metadata

Every workflow must begin with a static metadata export.

```ts
export const meta = {
  name: "workflow-name",
  description: "Human-readable workflow description",
  phases: ["scan", "review", "summarize"]
};
```

Rules:

- `meta` must be the first top-level statement.
- `meta.name` is required.
- `meta.description` is required.
- `meta.phases` is optional.
- Dynamic expressions are rejected.

Valid:

```ts
export const meta = {
  name: "review",
  description: "Review changed files"
};
```

Invalid:

```ts
const name = "review";

export const meta = {
  name,
  description: "Review changed files"
};
```

---

## Workflow DSL

OpenFlow workflows run in a constrained runtime. The runtime exposes a clean, expressive DSL.

### `agent(input)`

Runs a provider-backed agent task (either a direct agent or a registered shared agent).

Direct agent call:

```ts
const result = await agent({
  id: "review-auth",
  provider: "codex",
  prompt: "Review src/auth.ts for correctness and security issues."
});
```

Shared agent call:

```ts
const result = await agent({
  definition: "security-reviewer",
  file: "src/auth.ts" // context variable consumed by the template
});
```

Supported input:

```ts
type AgentCallInput = DirectAgentCallInput | DefinitionAgentCallInput;

// Direct provider call
type DirectAgentCallInput = {
  id?: string;
  label?: string;
  provider?: string;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs?: number;
  cwd?: string;
  permissions?: { mode: "dangerously-full-access" };
  metadata?: Record<string, unknown>;
};

// Registered shared agent call
type DefinitionAgentCallInput = {
  definition: string;
  id?: string;
  label?: string;
  provider?: string;
  prompt?: string;
  model?: string;
  schema?: JsonSchema;
  timeoutMs?: number;
  cwd?: string;
  permissions?: { mode: "dangerously-full-access" };
  metadata?: Record<string, unknown>;
  [contextKey: string]: unknown; // additional context fields passed to the template
};
```

### `parallel(tasks)`

Runs independent tasks under the configured global concurrency limit.

Object form:

```ts
const reviews = await parallel({
  auth: () => agent({
    id: "review-auth",
    prompt: "Review src/auth.ts"
  }),
  billing: () => agent({
    id: "review-billing",
    prompt: "Review src/billing.ts"
  })
});
```

Array form:

```ts
const files = ["src/auth.ts", "src/billing.ts"];

const reviews = await parallel(
  files.map(file => () => agent({
    id: `review:${file}`,
    prompt: `Review ${file}`
  }))
);
```

### `phase(name)`

Marks the current workflow phase.

```ts
phase("review");
```

### `log(message, data?)`

Adds a workflow log event.

```ts
log("Starting review", { files: 2 });
```

### `pipeline(items, stages, options?)`

Processes an array of input items through a sequence of stage objects sequentially or concurrently depending on the strategy.

```ts
const pipelineResults = await pipeline(
  ["src/auth.ts", "src/billing.ts"],
  [
    {
      name: "lint",
      run: async (file, ctx) => {
        ctx.log(`Linting ${file}`);
        const res = await ctx.agent({
          id: ctx.agentId("lint"),
          prompt: `Find lint errors in ${file}`
        });
        return { file, result: res.text };
      }
    }
  ],
  {
    strategy: "item-streaming", // or "stage-barrier"
    concurrency: 2,
    preserveOrder: true
  }
);
```

Supported options:
- `strategy`: `"item-streaming"` (processes each item completely through all stages concurrently) or `"stage-barrier"` (processes all items through stage 1 before starting stage 2). Default is `"item-streaming"`.
- `concurrency`: Global max concurrent items/stages processing.
- `stageConcurrency`: Object mapping stage name to specific concurrency value.
- `preserveOrder`: Boolean to keep the output in the same order as items. Default is `true`.
- `failFast`: Boolean to stop processing on first item/stage failure.

The `PipelineStageContext` (`ctx`) object passed to each stage contains:
- `pipelineId` and `runId` (strings)
- `itemIndex` and `stageIndex` (numbers)
- `stageName` (string)
- `agent(input)`: Run an agent call (direct or shared agent definition) with guaranteed scoped context.
- `log(message, data?)`: Log pipeline-specific messages.
- `agentId(suffix?)`: Helper to generate a unique agent ID.
- `signal`: AbortSignal for the stage.
- `sleep(ms)`: Utility to pause execution within the stage.

### `workflow(input)`

Invokes another workflow as a child of the current workflow. Child workflows run in a fresh isolated context with their own `args`, `phase` state, and cancellation signal.

```ts
const result = await workflow({
  name: "security-review",
  args: { target: "src/auth.ts" }
});
```

Supported input:

```ts
type WorkflowCallInput = {
  name: string;
  args?: JsonObject;
  failureMode?: "throw" | "settled";
  timeoutMs?: number;
  concurrency?: number;
  metadata?: JsonObject;
};
```

Behavior:
- `failureMode: "throw"` (default): Rejects if the child workflow fails.
- `failureMode: "settled"`: Resolves to a `WorkflowSettledResult` containing success/failure status and output.
- `timeoutMs`: Limits the execution time of the child workflow invocation.
- `concurrency`: Sets a local concurrency ceiling for agent tasks within the child invocation subtree.
- Recursion and excessive depth (default max 8) are rejected.
- Child workflows inherit root security policy and provider configuration.

### `tool(input)`

Invokes a registered tool. Tools are deterministic, trusted host extensions that run locally. They are intended for operations that need direct filesystem, process, or network access that the restricted workflow DSL cannot perform.

```ts
const result = await tool({
  definition: "read-json",
  args: { path: "package.json" }
});
```

Supported input:

```ts
type ToolCallInput = {
  definition: string;
  args: JsonObject;
  id?: string;
  label?: string;
  timeoutMs?: number;
  failureMode?: "throw" | "settled";
  metadata?: JsonObject;
};
```

Behavior:
- `tool()` can only be called from the top-level of a root or child workflow. It is forbidden in `parallel()` tasks, `pipeline()` stages, or shared-agent execution.
- `failureMode: "throw"` (default): Throws an error if the tool execution fails.
- `failureMode: "settled"`: Returns a `ToolSettledResult` object.
- Tools are **not** provider-native tools; they are local TypeScript modules registered in the project.

---

## Tools

Tools allow workflows to perform privileged operations. They are defined in `.openflow/tools/` and must export a default `defineTool()` result.

### Creating a Tool

```ts
// .openflow/tools/read-json.ts
import { defineTool } from "@prmflow/openflow";

export default defineTool({
  id: "read-json",
  description: "Reads and parses a JSON file",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" }
    },
    required: ["path"]
  },
  run: async ({ path }) => {
    const content = await fs.readFile(path, "utf8");
    return JSON.parse(content);
  }
});
```

### Security Warning: Trusted Extensions

Registered tool definition modules are **trusted host extensions**.
- Module-level code and the `run()` function execute with the same effective filesystem, process, environment, network, and package access as the OpenFlow process.
- Tool modules are loaded and evaluated during `run`, `validate`, and `doctor`.
- **Do not place untrusted code in the tools directory.**

---

## Structured Output

Agent calls can request structured output by providing a JSON Schema. `schema` is the validation contract; `structuredOutput.transport` controls how that schema reaches the provider.

```ts
const result = await agent({
  id: "review-auth",
  provider: "codex",
  prompt: "Return review findings as JSON.",
  schema: {
    type: "object",
    properties: {
      file: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "string"
        }
      }
    },
    required: ["file", "findings"]
  },
  structuredOutput: {
    transport: "auto"
  }
});
```

Transport options:

- `auto`: use prompt injection for current providers and keep local validation enabled.
- `prompt`: always inject the schema into the prompt before invoking the provider.
- `validate-only`: do not inject the schema into the prompt; only validate the returned output locally.
- `native`: reserved for future provider-native structured output support. Current adapters reject it.

When a schema is provided, OpenFlow attempts to normalize provider output in this order:

1. Provider-specific structured JSON, when the adapter can identify it.
2. Provider JSON output, when available.
3. First valid JSON object or block extracted from stdout.
4. Schema validation failure if no valid JSON is available.

A validation failure is returned as a failed agent result and persisted as an artifact.

---

## Configuration

By default, OpenFlow loads:

```text
.openflow/config.yaml
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
    defaultModel: gemini-3-flash-preview

  opencode:
    command: opencode
    args: ["run", "--format", "json"]

  antigravity:
    command: agy
    useSandboxByDefault: true

  pi:
    command: pi
    args: ["--mode", "json"]

  mock:
    command: mock
    responses:
      default:
        text: "mock response"

security:
  passEnv: []
  redactEnv:
    - OPENAI_API_KEY
    - GEMINI_API_KEY
    - GOOGLE_API_KEY
    - '*_TOKEN'
    - '*_SECRET'
```

Configuration precedence:

1. CLI safety ceilings and hard overrides.
2. Explicit `agent()` options.
3. Workflow defaults, if introduced later.
4. Config file.
5. Built-in defaults.

`--provider` sets the default provider. It does not override an explicit provider inside an `agent()` call.

---

## Model Selection

Model selection can be configured globally, per provider, on the command line, or explicitly within workflows.

### Precedence Rules

When resolving which model to use for an agent task, OpenFlow applies the following precedence (from strongest to weakest):

1. **Per-agent model**: Defined explicitly in the workflow script: `agent({ model: "model-name" })`.
2. **CLI override**: Provided via the `--model` (or `-m`) option: `openflow run workflow.ts --model model-name`.
3. **Provider-specific default model**: Configured in `.openflow/config.yaml` under `providers.<provider>.defaultModel`.
4. **Global default model**: Configured in `.openflow/config.yaml` under `defaultModel`.
5. **Provider default**: If no model is configured, the provider's CLI decides.

### Provider Flag Customization (`modelArg`)

By default, the `codex` provider CLI uses `--model <model>` and the `gemini` provider CLI uses `-m <model>`. You can customize this flag or disable model selection entirely for any provider in `.openflow/config.yaml`:

```yaml
defaultModel: gemini-3-flash-preview # Global default model

providers:
  codex:
    command: codex
    modelArg:
      flag: --custom-model-flag # Custom flag instead of default --model
      
  gemini:
    command: gemini
    modelArg: false # Disable model selection (errors if a model is requested)
```

---

## Reports

OpenFlow supports three report modes.

### Pretty

Default local terminal output:

```bash
openflow run workflows/review.ts --report pretty
```

Example output:

```text
◇ parallel-review
  Phase: review

  ✓ codex-review       codex    18.3s
  ✕ gemini-review      gemini   failed

Artifacts:
  .openflow/runs/20260602-abc123
```

### JSON

Prints only the final workflow report JSON object to stdout.

```bash
openflow run workflows/review.ts --report json
```

### JSONL

Streams ordered execution events to stdout.

```bash
openflow run workflows/review.ts --report jsonl
```

JSONL is intended for CI jobs, dashboards, and tools that want to consume live workflow events.

---

## Artifacts

Every run creates a local artifact directory.

```text
.openflow/runs/<runId>/
  manifest.json
  workflow.input.ts
  config.resolved.json
  run-input.json
  calls.jsonl
  cache-index.json
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
      permissions.json
      metadata.json
  workflows/
    <workflowInvocationId>/
      input.json
      result.json
      error.json
      summary.json
```

Artifacts are always enabled so failed or partial runs remain debuggable.

---

## Exit Codes

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

---

## Safety Model

OpenFlow is safe by default, but should not be described as a complete security sandbox.

Default security behavior:

- Workflow shell execution is unavailable.
- Arbitrary workflow imports are unavailable.
- Environment variables are not passed unless allowlisted.
- Secret-like values are redacted from terminal output, events, reports, and persisted logs where feasible.
- Provider prompts and outputs are stored as artifacts.
- Provider CLIs may still access files, network, and credentials according to their own behavior and permissions.

### Agent Permissions & Write Access

Workflows can request write-capable access for specific agents:

```ts
agent({
  id: "apply-patch",
  provider: "codex",
  prompt: "Apply the review findings to src/auth.ts.",
  permissions: {
    mode: "dangerously-full-access"
  }
})
```

#### Safety & System Context:
- **No Scoped Sandbox:** The `dangerously-full-access` mode is **not** a sandbox or a scoped-write system. It grants full permission mapping to the underlying provider CLI, bypassing safety boundaries in that provider context.
- **Provider Support Behavior:**
  - `codex`: Maps `dangerously-full-access` to the Codex write-capable flag (`--dangerously-bypass-approvals-and-sandbox`).
  - `gemini`: Supports `dangerously-full-access`. By default, Gemini runs in read-only `--approval-mode plan`. Specifying `dangerously-full-access` switches Gemini to `--approval-mode yolo`, enabling write-capable execution. This is the explicit opt-in; Gemini's own trust and sandbox rules still apply.
  - `opencode`: Maps `dangerously-full-access` to `--dangerously-skip-permissions` and skips read-only environment injection.
  - `antigravity`: Maps `dangerously-full-access` to `--dangerously-skip-permissions`.
  - `pi`: Switches from read-only tools to configured `fullAccessTools`. It does not imply automatic approval.
  - `mock`: Accepts `dangerously-full-access` without changing its deterministic mock behavior (useful for dry runs and testing).
  - Workflows that omit the `permissions` field default to `{ mode: "default" }` (which does not pass any write-enabling flags to the provider).

Be careful before sharing `.openflow/runs/<runId>` artifacts, because they may contain prompts, source snippets, stdout, stderr, and model outputs.

---

## CI Usage

Example GitHub Actions-style command:

```bash
openflow validate workflows/review.ts
openflow run workflows/review.ts \
  --provider mock \
  --report json \
  --concurrency 2 \
  --timeout-ms 600000
```

For streaming logs:

```bash
openflow run workflows/review.ts --report jsonl
```

For deterministic CI tests, prefer the `mock` provider.

---

## Troubleshooting

### Provider CLI is missing

Run:

```bash
openflow doctor
```

If `codex` or `gemini` is missing, install the relevant provider CLI and ensure it is available in `PATH`.

### Workflow validation fails

Run:

```bash
openflow validate workflows/review.ts
```

Check that:

- `export const meta = ...` is the first top-level statement.
- Metadata values are literals.
- The workflow does not use `require()`, arbitrary imports, filesystem APIs, process APIs, shell commands, or unsupported DSL functions.

### JSON report contains failed agents

Inspect the run artifacts:

```bash
cat .openflow/runs/<runId>/report.json
cat .openflow/runs/<runId>/agents/<agentId>/stderr.log
cat .openflow/runs/<runId>/agents/<agentId>/validation-error.json
```

### Agent output failed schema validation

Check:

```bash
.openflow/runs/<runId>/agents/<agentId>/raw-result.json
.openflow/runs/<runId>/agents/<agentId>/validation-error.json
```

Then update the prompt, schema, or provider output format.

---

## Example Workflows

### Parallel Code Review

```ts
export const meta = {
  name: "parallel-code-review",
  description: "Review files in parallel",
  phases: ["review"]
};

const files = ["src/auth.ts", "src/billing.ts"];

phase("review");

const reviews = await parallel(
  files.map(file => () => agent({
    id: `review:${file}`,
    provider: "codex",
    prompt: `Review ${file} for correctness and maintainability issues.`,
    schema: {
      type: "object",
      properties: {
        file: { type: "string" },
        findings: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["file", "findings"]
    }
  }))
);

export default {
  reviews
};
```

### Test Failure Triage

```ts
export const meta = {
  name: "test-failure-triage",
  description: "Analyze failing tests and propose next steps"
};

phase("triage");

const result = await agent({
  id: "triage",
  provider: "codex",
  prompt: "Inspect the failing tests and propose the smallest safe fix."
});

export default result;
```

---

## Development

Suggested local development commands:

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm test
```

Recommended test coverage:

- Config loading and precedence
- Metadata parsing
- Workflow validation restrictions
- Event sequencing
- Artifact generation
- Scheduler concurrency behavior
- Process timeout behavior
- Schema validation success and failure
- Provider command construction
- Mock provider integration workflows

---

## Agent Skills

For AI/coding agents developing workflows in this repository, a pre-configured skill is located at [skills/openflow-workflow-writer/](skills/openflow-workflow-writer/).

This directory contains:
- [SKILL.md](skills/openflow-workflow-writer/SKILL.md): Instructions and guidelines for AI agents to write, validate, and troubleshoot OpenFlow workflows.
- Reference documentation under [references/](skills/openflow-workflow-writer/references/):
  - [api-document.md](skills/openflow-workflow-writer/references/api-document.md): Complete guide on workflow syntax, DSL primitives (`agent`, `parallel`, `pipeline`), structured outputs, and exit codes.
  - [cli-commands.md](skills/openflow-workflow-writer/references/cli-commands.md): Detailed usage details for the `run`, `validate`, and `doctor` commands.
  - [configuration.md](skills/openflow-workflow-writer/references/configuration.md): Schema structure, precedence rules, and model customization guidelines for `.openflow/config.yaml`.
- Reusable templates under `assets/` for building new workflows.

---

## Design Principles

OpenFlow follows these boundaries:

1. Workflow DSL does not know provider-specific details.
2. Runtime does not spawn processes directly.
3. Provider adapters do not own workflow failure policy.
4. Process execution is provider-agnostic.
5. Structured output validation is local and provider-independent.
6. Reporters consume events but do not control execution.
7. Artifact storage is central to observability and debugging.

---

## License

MIT
