# OpenFlow API Reference

This reference summarizes the OpenFlow workflow DSL, CLI commands, providers, pipeline options, reporting modes, artifacts, and exit codes.

Use this file as the syntax reference when creating OpenFlow workflow scripts.

---

## 1. Workflow File Shape

Every workflow file must begin with a static metadata export.

```ts
export const meta = {
  name: "workflow-name",
  description: "Human-readable workflow description",
  phases: ["prepare", "execute", "summarize"],
  version: "1.0.0",
  tags: ["security", "auth"]
};
```

Requirements:

* `meta` must be the first top-level statement.
* `meta.name` is required.
* `meta.description` is required.
* `meta.phases` is optional (array of phase name strings).
* `meta.version` is optional (string).
* `meta.tags` is optional (array of strings).
* Metadata must use static literal values.
* Dynamic metadata expressions are rejected.

A workflow should export its final result:

```ts
export default {
  result
};
```

---

## 2. DSL Overview

OpenFlow exposes these workflow DSL primitives:

| API          | Purpose                                         |
| ------------ | ----------------------------------------------- |
| `agent()`    | Run one provider-backed agent task or a shared agent definition. |
| `parallel()` | Run independent async task thunks concurrently. |
| `pipeline()` | Process many items through ordered stages.      |
| `phase()`    | Mark the current workflow phase.                |
| `log()`      | Emit a workflow log event.                      |
| `workflow()` | Invoke another workflow as a child.            |
| `tool()`     | Run a registered deterministic tool definition. |

---

## 3. `agent()`

Runs a provider-backed agent task.

### Object form

```ts
const result = await agent({
  id: "review-auth",
  provider: "codex",
  prompt: "Review src/auth.ts for correctness and security issues."
});
```

### Conceptual input type

```ts
type AgentCallInput = DirectAgentCallInput | DefinitionAgentCallInput;

type DirectAgentCallInput = {
  id?: string;
  label?: string;
  provider?: "codex" | "gemini" | "mock" | "opencode" | "antigravity" | "pi" | string;
  prompt: string;
  model?: string;
  schema?: JsonSchema;
  structuredOutput?: {
    transport?: "auto" | "prompt" | "validate-only" | "native";
  };
  timeoutMs?: number;
  cwd?: string;
  permissions?: { mode: "dangerously-full-access" };
  metadata?: Record<string, unknown>;
};

type DefinitionAgentCallInput = {
  id?: string;
  definition: string;
  label?: string;
  provider?: "codex" | "gemini" | "mock" | "opencode" | "antigravity" | "pi" | string;
  prompt?: string;
  model?: string;
  schema?: JsonSchema;
  structuredOutput?: {
    transport?: "auto" | "prompt" | "validate-only" | "native";
  };
  timeoutMs?: number;
  cwd?: string;
  permissions?: { mode: "dangerously-full-access" };
  metadata?: Record<string, unknown>;
  [key: string]: any; // Custom variables required by the shared agent
};
```

### Fields

| Field             | Required | Description                                                                    |
| ----------------- | -------: | ------------------------------------------------------------------------------ |
| `id`              |       No | Stable identifier for the agent call and artifacts.                            |
| `label`           |       No | Human-readable label for output.                                               |
| `provider`        |       No | Provider to use: `codex`, `gemini`, `mock`, or configured provider.            |
| `prompt`          |      Yes | Prompt sent to the provider.                                                   |
| `model`           |       No | Model override for this call.                                                  |
| `schema`          |       No | JSON Schema used to validate structured output.                                |
| `structuredOutput`|       No | Controls how a provided schema reaches the provider.                           |
| `timeoutMs`       |       No | Per-agent timeout in milliseconds.                                             |
| `cwd`             |       No | Working directory for the provider call.                                       |
| `permissions`     |       No | Permission mode for this agent call. Omit for default sandboxed behaviour.    |
| `metadata`        |       No | Descriptive metadata for reports or artifacts.                                 |

### Structured output

Use `schema` when downstream workflow steps need machine-readable output. When a schema is provided, OpenFlow validates the normalized provider output locally.

`structuredOutput.transport` controls how the schema is supplied:

| Transport | Behavior |
| --------- | -------- |
| `auto` | Default. Current providers use prompt injection and local validation. |
| `prompt` | Always inject schema instructions into the provider prompt and validate locally. |
| `validate-only` | Do not inject the schema; validate whatever the provider returns. |
| `native` | Reserved for future provider-native structured output. Current `codex`, `gemini`, and `mock` adapters reject it. |

Recommended defaults:

* Use `structuredOutput: { transport: "auto" }` for most workflows with `schema`.
* Use `prompt` when you want the workflow to be explicit about prompt injection.
* Use `validate-only` only when your prompt already gives exact JSON output instructions.
* Do not use `native` unless the target adapter explicitly supports it.

### Example with schema and structured output

```ts
const result = await agent({
  id: "security-review",
  provider: "codex",
  prompt: "Return exactly one JSON object containing security findings.",
  schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string" },
            title: { type: "string" },
            evidence: { type: "string" },
            recommendation: { type: "string" }
          },
          required: ["severity", "title", "evidence", "recommendation"]
        }
      }
    },
    required: ["findings"]
  },
  structuredOutput: {
    transport: "auto"
  }
});
```

### Permissions

The `permissions` field controls the approval and sandbox mode passed to the provider CLI.

When omitted, OpenFlow uses `{ mode: "default" }` and providers run with their configured approval behaviour (e.g., `--approval-mode plan` for Gemini).

Only one mode is currently supported:

| Mode | Behaviour |
| ---- | --------- |
| `"dangerously-full-access"` | Runs the provider without approval prompts or sandbox restrictions. Use only when the workflow explicitly requires fully autonomous execution. |

Per-provider effect:

| Provider | Effect of `dangerously-full-access` |
| -------- | ----------------------------------- |
| `codex`  | Appends `--dangerously-bypass-approvals-and-sandbox` to the provider command. |
| `gemini` | Replaces `--approval-mode <value>` with `--approval-mode yolo` in the provider command. |
| `opencode`| Appends `--dangerously-skip-permissions` and skips read-only config injection. |
| `antigravity`| Appends `--dangerously-skip-permissions`. |
| `pi`      | Switches from `safeTools` to `fullAccessTools`. |
| `mock`   | Field is accepted and recorded but has no effect on mock execution. |

> **Security note:** `dangerously-full-access` allows the agent to read, write, and execute without confirmation prompts. Only use it when the task explicitly requires autonomous multi-step execution and the risk is understood and documented.

#### Example with permissions

```ts
const result = await agent({
  id: "autonomous-task",
  provider: "codex",
  // dangerously-full-access: codex runs without approval prompts or sandbox.
  // Use only when autonomous multi-step execution is intentional.
  permissions: { mode: "dangerously-full-access" },
  prompt: "Refactor src/auth.ts to use the new token interface. Apply changes directly."
});
```

---

## 4. `parallel()`

Runs independent task thunks under the configured concurrency limit.

Use `parallel()` when tasks do not depend on each other.

### Object form

```ts
const reviews = await parallel({
  correctness: () => agent({
    id: "correctness-review",
    provider: "codex",
    prompt: "Review for correctness issues."
  }),

  security: () => agent({
    id: "security-review",
    provider: "codex",
    prompt: "Review for security risks."
  })
});
```

### Array form

```ts
const files = ["src/auth.ts", "src/billing.ts"];

const reviews = await parallel(
  files.map(file => () => agent({
    id: `review:${file}`,
    provider: "codex",
    prompt: `Review ${file} for correctness and maintainability issues.`
  }))
);
```

### Rules

* Inputs should be task functions, not already-started promises.
* Tasks should be independent.
* Agent calls inside `parallel()` use the scheduler.
* Concurrency is controlled by CLI/config settings.
* Use `pipeline()` instead if each item must pass through ordered stages.

---

## 5. `pipeline()`

Processes an array of items through ordered stages.

Use `pipeline()` when many items need the same sequence of work.

An item is one input value being processed by the pipeline, such as a file path,
plan document, issue, test case, or JSON object.

A stage is one ordered processing step that every item passes through. The first
stage receives the original item. Each later stage receives the previous stage's
output for that same item.

### Example

```ts
const results = await pipeline(
  files,
  [
    {
      name: "analyze",
      run: (file, ctx) => ctx.agent({
        id: `analyze:${file}`,
        provider: "codex",
        prompt: `Analyze ${file}.`
      })
    },
    {
      name: "summarize",
      run: (analysis, ctx) => ctx.agent({
        id: "summarize-analysis",
        provider: "gemini",
        prompt: `Summarize this analysis:\n${JSON.stringify(analysis, null, 2)}`
      })
    }
  ],
  {
    label: "file-analysis-pipeline",
    strategy: "item-streaming",
    concurrency: 3,
    failFast: false
  }
);
```

### Conceptual signature

```ts
pipeline<I, O>(
  items: I[],
  stages: PipelineStage<any, any>[],
  options?: PipelineOptions
): Promise<PipelineResult<O>>;
```

### `PipelineStage` Type

A pipeline stage is represented as an object:

```ts
interface PipelineStage<I = unknown, O = unknown> {
  name: string;
  run: (input: I, context: PipelineStageContext) => Promise<O> | O;
  concurrency?: number;
  timeoutMs?: number;
}
```

*   `name`: Unique name for the stage.
*   `run`: The function executing the stage logic. It takes the stage input (the item or the output from the previous stage) and a `PipelineStageContext` object.
*   `concurrency`: Optional concurrency limit override for this specific stage.
*   `timeoutMs`: Optional timeout override for this specific stage.

### `PipelineStageContext`

Inside the `run` function, you must use the provided `context` to perform operations:

```ts
interface PipelineStageContext {
  pipelineId: string;
  runId: string;
  artifactsDir: string;
  itemIndex: number;
  stageIndex: number;
  stageName: string;
  agent(input: AgentCallInput): Promise<AgentResult>;
  log(message: string, data?: unknown): void;
  agentId(suffix?: string): string;
  signal: AbortSignal;
  sleep(ms: number): Promise<void>;
}
```

*   `ctx.agent(input)`: Executes an agent task within the context of the active pipeline.
*   `ctx.log(message, data?)`: Logs a structured message bound to the pipeline stage run.
*   `ctx.sleep(ms)`: Standard utility to sleep within the stage.
*   `ctx.signal`: Abort signal for abort handling.
*   `ctx.agentId(suffix?)`: Dynamically generates a unique agent ID prefix.

### Pipeline options

```ts
type PipelineOptions = {
  label?: string;
  strategy?: "item-streaming" | "stage-barrier";
  concurrency?: number;
  stageConcurrency?: Record<string, number>;
  preserveOrder?: boolean;
  failFast?: boolean;
};
```

### Option reference

| Option             | Type                          | Description                                                                     |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------- |
| `label`            | `string`                      | Human-readable pipeline label.                                                  |
| `strategy`         | `"item-streaming" \| "stage-barrier"` | `"item-streaming"` streams each item through stages. `"stage-barrier"` runs all items in a stage before moving to the next. |
| `concurrency`      | `number`                      | Maximum number of active item processors.                                       |
| `stageConcurrency` | `Record<string, number>`      | Concurrency overrides per stage name.                                           |
| `preserveOrder`    | `boolean`                     | If true, outputs will match the order of input items.                           |
| `failFast`         | `boolean`                     | If true, the first item-stage failure aborts the entire pipeline execution.     |

### Pipeline concurrency model

`pipeline()` has item-level and stage-level concurrency. Agent calls made inside
stages still go through the scheduler, which has its own CLI/config concurrency.

| Layer | Controlled by | Limits |
| ----- | ------------- | ------ |
| Pipeline item concurrency | `options.concurrency` | How many items may be active in the pipeline at the same time. |
| Stage concurrency | `stage.concurrency` and `options.stageConcurrency[stageName]` | How many executions of a specific stage may run at the same time. The effective stage limit is the strictest positive limit among the stage setting, pipeline item concurrency, and stage concurrency override. |
| Scheduler concurrency | CLI/config `concurrency` | How many provider-backed agent tasks may run at the same time. |

`options.concurrency` is not a total agent limit. If three items are active and
one stage calls `parallel()` with three `ctx.agent()` tasks per item, the stage
can enqueue up to nine agent tasks. The scheduler decides how many of those
agent tasks start immediately.

### Pipeline rules

* First argument must be an array.
* At least one stage is required.
* Each stage must be a named stage object (not an anonymous callback function).
* Each item runs stages sequentially.
* Multiple items can be active concurrently up to `options.concurrency`.
* With `item-streaming`, an item can move to its next stage as soon as that item finishes the current stage.
* With `stage-barrier`, all eligible items finish the current stage before any item starts the next stage.
* Results preserve input order by default.
* Agent calls inside stages must use `ctx.agent()`.
* Pipeline does not bypass the scheduler or provider adapters.
* Pipeline does not grant shell or filesystem permissions.

---

## 6. `phase()`

Marks the current workflow phase.

```ts
phase("review");
```

Use phases to make terminal output and reports easier to understand.

Common phases:

```ts
phase("prepare");
phase("scan");
phase("review");
phase("triage");
phase("summarize");
phase("report");
```

Rules:

* Phase names should be stable and human-readable.
* Phase names should match `meta.phases` when phases are declared.
* Pipeline stages do not automatically become phases.

---

## 7. `log()`

Emits a workflow log event.

```ts
log("Starting review", { fileCount: files.length });
```

Use logs for:

* input counts
* selected strategy
* current milestone
* non-sensitive debugging metadata

Do not log:

* secrets
* tokens
* private credentials
* large raw outputs
* unnecessary source dumps

---

## 8. `workflow()`

Invokes another workflow as a child of the current workflow.

### Example

```ts
const result = await workflow({
  name: "security-review",
  args: { target: "src/auth.ts" }
});
```

### Conceptual input type

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

### Fields

| Field         | Required | Description                                                                         |
| ------------- | -------: | ----------------------------------------------------------------------------------- |
| `name`        |      Yes | Name of the child workflow to invoke (must be registered).                          |
| `args`        |       No | Input arguments passed to the child workflow.                                       |
| `failureMode` |       No | `"throw"` (default) or `"settled"`. Controls error handling.                         |
| `timeoutMs`   |       No | Maximum execution time for the child invocation.                                     |
| `concurrency` |       No | Local concurrency limit for agents within the child invocation subtree.             |
| `metadata`    |       No | Custom metadata for the invocation.                                                 |

### Behavior

* **Isolation**: Child workflows run in a fresh context with their own `args` and `phase` state.
* **Cloning**: `args` and results are deep-cloned using JSON-safe rules to prevent mutation leakage.
* **Cancellation**: If the parent workflow is cancelled, the child and all its descendants are aborted.
* **Recursion**: Active recursion (e.g., A calling B calling A) is detected and rejected at runtime.
* **Depth**: Maximum invocation depth is enforced (default 8).

---

## 9. `tool()`

Runs a registered, deterministic tool definition.

### Object form

```ts
const data = await tool({
  definition: "read-json",
  args: {
    path: "reports/findings.json"
  },
  timeoutMs: 10000,
  failureMode: "throw",
  metadata: {
    purpose: "load-findings"
  }
});
```

### Conceptual input type

```ts
type ToolCallInput = {
  definition: string;
  args: unknown;
  id?: string;
  label?: string;
  timeoutMs?: number;
  failureMode?: "throw" | "settled";
  metadata?: Record<string, unknown>;
};
```

### Fields

| Field | Required | Description |
|---|---:|---|
| `definition` | Yes | Stable ID of a registered tool definition. |
| `args` | Yes | Input passed to the tool. Must be serializable JSON. |
| `id` | No | Stable call identifier used in events and artifact paths. |
| `label` | No | Human-readable label for terminal output and reports. |
| `timeoutMs` | No | Per-call timeout in milliseconds. |
| `failureMode` | No | `"throw"` (default) or `"settled"`. Controls failure handling. |
| `metadata` | No | Descriptive metadata for reports or artifacts. |

### Return value

* With the default `failureMode: "throw"`, a successful call returns the tool output directly:
  ```ts
  const output = await tool({
    definition: "read-json",
    args: { path: "report.json" }
  });
  ```
* With `failureMode: "settled"`, the call resolves to a result envelope:
  ```ts
  type ToolSettledResult<T> =
    | {
        status: "succeeded";
        ok: true;
        toolCallId: string;
        definition: string;
        value: T;
        startedAt: string;
        finishedAt: string;
        durationMs: number;
        artifactPath: string;
      }
    | {
        status: "failed" | "cancelled" | "timed_out";
        ok: false;
        toolCallId: string;
        definition: string;
        error: SerializedError;
        startedAt?: string;
        finishedAt: string;
        durationMs: number;
        artifactPath: string;
      };
  ```
  Note: Input validation and definition lookup failures represent programming errors and will always throw an error even in `"settled"` mode.

### Allowed contexts

* Top-level workflow execution.
* Top-level inside child workflows invoked via `workflow()`.
* **Not allowed**: inside `parallel()`, inside pipeline stages (`pipeline()`), inside `defineAgent.run()`, or nested inside tool definitions.

---

## 10. Providers

OpenFlow provider adapters coordinate external agent CLIs.

Built-in providers:

| Provider | Use                                                                |
| -------- | ------------------------------------------------------------------ |
| `mock`   | Tests, examples, smoke workflows, deterministic CI.                |
| `codex`  | Code review, correctness, security, implementation reasoning.      |
| `gemini` | Test strategy, operational review, broad synthesis, summarization. |
| `opencode` | General purpose coding agent with read-only config injection. |
| `antigravity` | High-fidelity terminal-first agent with sandbox support. |
| `pi` | Tool-use coding agent with explicit safe/full toolsets. |

Provider behavior should not leak into workflow semantics. Workflows should call `agent()` and let the runtime, scheduler, and adapter handle provider execution.

### Provider permissions behaviour

The `permissions` field on `agent()` affects provider CLI arguments at the adapter level.

| Provider | Default approval mode | `dangerously-full-access` effect |
| -------- | --------------------- | -------------------------------- |
| `codex`  | Ephemeral sandbox with approvals | Appends `--dangerously-bypass-approvals-and-sandbox` |
| `gemini` | `--approval-mode plan` (or config default) | Replaces `--approval-mode <value>` with `--approval-mode yolo` |
| `mock`   | No subprocess approval concept | Field is accepted and recorded; no runtime effect |

---

## 11. Model Selection

Model selection can be configured globally, per provider, from the CLI, or per agent.

Precedence from strongest to weakest:

1. Per-agent `model`.
2. CLI `--model`.
3. Provider-specific default model in config.
4. Global default model in config.
5. Provider CLI default.

Example:

```ts
const result = await agent({
  id: "review",
  provider: "codex",
  model: "model-name",
  prompt: "Review this change."
});
```

---

## 12. Reports

OpenFlow supports three report modes.

### Pretty

Human-readable terminal output for local development.

```bash
openflow run workflows/review.ts --report pretty
```

### JSON

Prints only the final workflow report JSON object to stdout.

```bash
openflow run workflows/review.ts --report json
```

Use for CI jobs and automation.

### JSONL

Streams ordered execution events to stdout.

```bash
openflow run workflows/review.ts --report jsonl
```

Use for CI logs, dashboards, and live event consumers.

---

## 13. Artifacts

Every run creates a local artifact directory.

```text
.openflow/runs/<runId>/
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
  pipelines/
    <pipelineId>/
      pipeline.json
      items/
        <itemIndex>/
          item.json
          stages/
            <stageName>/
              stage-result.json
  workflows/
    <workflowInvocationId>/
      input.json
      result.json
      error.json
      summary.json
  tools/
    <toolCallId>/
      metadata.json
      input.json
      output.json
      error.json
```

Use artifacts to debug:

* prompts sent to providers
* provider stdout and stderr
* normalized results
* schema validation failures
* pipeline item failures
* final reports
* event order

Artifacts may contain prompts, source snippets, and model outputs. Treat them as sensitive.

---

## 14. Pipeline Events

Pipeline execution emits events such as:

```text
pipeline.started
pipeline.item.started
pipeline.stage.started
pipeline.stage.completed
pipeline.stage.failed
pipeline.item.completed
pipeline.item.failed
pipeline.completed
pipeline.failed
pipeline.cancelled
```

JSONL consumers should treat unknown event types as forward-compatible and ignore events they do not understand.

---

## 15. Exit Codes

| Code | Meaning                            |
| ---: | ---------------------------------- |
|    0 | Success                            |
|    1 | Workflow failed                    |
|    2 | Invalid CLI usage                  |
|    3 | Workflow parse or validation error |
|    4 | Provider unavailable               |
|    5 | Security policy violation          |
|    6 | User cancelled                     |
|    7 | Timeout                            |
|    8 | Internal error                     |

---

## 16. Out-of-Scope or Gated Capabilities

Do not assume these are available unless explicitly implemented or enabled:

* distributed execution
* resumable runs
* approval gates
* DAG or branching pipelines
* stage-level pipeline caching
* automatic patch application
* automatic merge, commit, or push behavior
* hosted dashboard
* third-party provider plugin loading
* shell execution
* worktree isolation
* container isolation
* retry policies

---

## 17. Common Validation Mistakes

Bad: metadata is not first.

```ts
const workflowName = "review";

export const meta = {
  name: workflowName,
  description: "Review code"
};
```

Good:

```ts
export const meta = {
  name: "review",
  description: "Review code"
};
```

Bad: passing a promise to `parallel()`.

```ts
const results = await parallel([
  agent({ id: "a", prompt: "Run A" }),
  agent({ id: "b", prompt: "Run B" })
]);
```

Good:

```ts
const results = await parallel([
  () => agent({ id: "a", prompt: "Run A" }),
  () => agent({ id: "b", prompt: "Run B" })
]);
```

Bad: passing function shorthands as stages to `pipeline()`.

```ts
const results = await pipeline(
  files,
  [
    file => agent({
      id: `review:${file}`,
      prompt: `Review ${file}`
    })
  ]
);
```

Good:

```ts
const results = await pipeline(
  files,
  [
    {
      name: "review",
      run: (file, ctx) => ctx.agent({
        id: `review:${file}`,
        prompt: `Review ${file}`
      })
    }
  ]
);
```

Bad: calling global `agent()` inside a pipeline stage instead of `ctx.agent()`.

```ts
const results = await pipeline(
  files,
  [
    {
      name: "review",
      run: (file) => agent({
        id: `review:${file}`,
        prompt: `Review ${file}`
      })
    }
  ]
);
```

Good:

```ts
const results = await pipeline(
  files,
  [
    {
      name: "review",
      run: (file, ctx) => ctx.agent({
        id: `review:${file}`,
        prompt: `Review ${file}`
      })
    }
  ]
);
```

Bad: forgetting to return the result of an agent call inside `parallel()` or a pipeline stage `run()`.

```ts
// Inside parallel - agent call promise is created but not returned:
const results = await parallel({
  correctness: () => {
    agent({ id: "correctness", prompt: "Check correctness" });
  }
});
```

Good:

```ts
const results = await parallel({
  correctness: () => agent({ id: "correctness", prompt: "Check correctness" })
});
```

Bad: using an unsupported `permissions.mode` value.

```ts
const result = await agent({
  id: "task",
  prompt: "Do something.",
  permissions: { mode: "read-only" }  // ❌ Only "dangerously-full-access" is supported.
});
```

Good:

```ts
const result = await agent({
  id: "task",
  prompt: "Do something.",
  permissions: { mode: "dangerously-full-access" }  // ✅ Only valid mode.
});
```

Bad: including extra keys in the `permissions` object.

```ts
const result = await agent({
  id: "task",
  prompt: "Do something.",
  permissions: { mode: "dangerously-full-access", scope: "write" }  // ❌ Extra keys are rejected.
});
```

Good:

```ts
const result = await agent({
  id: "task",
  prompt: "Do something.",
  permissions: { mode: "dangerously-full-access" }  // ✅ Only 'mode' is allowed.
});
```

Bad: calling `tool()` inside a `parallel()` block.

```ts
const results = await parallel({
  load: () => tool({ definition: "read-json", args: { path: "data.json" } }) // ❌ tool() is not allowed in parallel context.
});
```

Good: call `tool()` first, then pass the result to `parallel()`.

```ts
const data = await tool({ definition: "read-json", args: { path: "data.json" } });
const results = await parallel({
  analyze: () => agent({ prompt: `Analyze: ${JSON.stringify(data)}` })
});
```

Bad: calling `tool()` inside a pipeline stage.

```ts
const results = await pipeline(
  files,
  [
    {
      name: "process",
      run: (file) => tool({ definition: "process-file", args: { file } }) // ❌ tool() is not allowed in pipeline context.
    }
  ]
);
```

Bad: aliasing `tool()`.

```ts
const myTool = tool; // ❌ Aliasing tool() is not allowed.
await myTool({ definition: "read-json", args: { path: "data.json" } });
```

---

## 18. Minimal Workflow Template

```ts
export const meta = {
  name: "basic-workflow",
  description: "Run a basic OpenFlow workflow",
  phases: ["execute"]
};

phase("execute");

const result = await agent({
  id: "main-task",
  provider: "codex",
  prompt: "Complete the requested task and return exactly one JSON object.",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      nextSteps: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["summary", "nextSteps"]
  },
  structuredOutput: {
    transport: "auto"
  }
});

export default {
  result
};
```

---

## 19. Parallel Workflow Template

```ts
export const meta = {
  name: "parallel-review",
  description: "Run independent review agents in parallel and summarize the results",
  phases: ["review", "summarize"]
};

phase("review");

const reviews = await parallel({
  correctness: () => agent({
    id: "correctness-review",
    provider: "codex",
    prompt: "Review for correctness issues."
  }),

  security: () => agent({
    id: "security-review",
    provider: "codex",
    prompt: "Review for security risks."
  }),

  tests: () => agent({
    id: "test-review",
    provider: "gemini",
    prompt: "Review test coverage and missing test cases."
  })
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "gemini",
  prompt: `Summarize these reviews:\n${JSON.stringify(reviews, null, 2)}`
});

export default {
  reviews,
  summary
};
```

---

## 20. Pipeline Workflow Template

```ts
export const meta = {
  name: "pipeline-review",
  description: "Analyze multiple items through ordered review stages",
  phases: ["review", "summarize"]
};

const items = ["src/auth.ts", "src/billing.ts", "src/api.ts"];

phase("review");

const itemResults = await pipeline(
  items,
  [
    {
      name: "analyze",
      run: (item, ctx) => ctx.agent({
        id: `analyze:${item}`,
        provider: "codex",
        prompt: `Analyze ${item} for correctness, security, and maintainability risks. Return exactly one JSON object.`,
        schema: {
          type: "object",
          properties: {
            item: { type: "string" },
            findings: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["item", "findings"]
        },
        structuredOutput: {
          transport: "auto"
        }
      })
    },
    {
      name: "plan",
      run: (analysis, ctx) => ctx.agent({
        id: "plan",
        provider: "gemini",
        prompt: `Create a remediation plan from this analysis:\n${JSON.stringify(analysis, null, 2)}`
      })
    },
    {
      name: "review-plan",
      run: (plan, ctx) => ctx.agent({
        id: "review-plan",
        provider: "codex",
        prompt: `Review this plan for safety and completeness:\n${JSON.stringify(plan, null, 2)}`
      })
    }
  ],
  {
    label: "item-review-pipeline",
    strategy: "item-streaming",
    concurrency: 3,
    failFast: false
  }
);

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "gemini",
  prompt: `Summarize these pipeline results:\n${JSON.stringify(itemResults, null, 2)}`
});

export default {
  itemResults,
  summary
};
```

---

## 21. Tool Workflow Template

```ts
export const meta = {
  name: "tool-workflow",
  description: "Run a workflow that invokes a registered tool and processes the result with an agent",
  phases: ["fetch", "analyze"]
};

phase("fetch");

// Invoke a registered deterministic tool to read data
const data = await tool({
  definition: "read-json",
  args: {
    path: "input.json"
  }
});

phase("analyze");

// Pass the tool output directly to a provider-backed agent
const analysis = await agent({
  id: "analyze-data",
  provider: "codex",
  prompt: `Analyze this dataset for anomalies and correctness:\n${JSON.stringify(data, null, 2)}`
});

export default {
  data,
  analysis
};
```

---

## 22. Workflow Patterns

These patterns show standard architectures for organizing OpenFlow workflows.

### Pattern 1: Single Agent

Use when one agent can complete the task.

```ts
const result = await agent({
  id: "task",
  provider: "codex",
  prompt: "Complete the task."
});
```

### Pattern 2: Parallel Review

Use when several independent perspectives can run at once.

```ts
const results = await parallel({
  correctness: () => agent({
    id: "correctness",
    provider: "codex",
    prompt: "Review correctness."
  }),
  security: () => agent({
    id: "security",
    provider: "codex",
    prompt: "Review security."
  }),
  tests: () => agent({
    id: "tests",
    provider: "gemini",
    prompt: "Review tests."
  })
});
```

### Pattern 3: Pipeline

Use when multiple items pass through the same ordered stages.

```ts
const results = await pipeline(
  items,
  [
    {
      name: "analyze",
      run: (item, ctx) => ctx.agent({
        id: `analyze:${item}`,
        provider: "codex",
        prompt: `Analyze ${item}`
      })
    },
    {
      name: "summarize",
      run: (analysis, ctx) => ctx.agent({
        id: "summarize",
        provider: "gemini",
        prompt: JSON.stringify(analysis)
      })
    }
  ],
  {
    label: "main-pipeline",
    strategy: "item-streaming",
    concurrency: 3,
    failFast: false
  }
);
```

### Pattern 4: Fan-Out / Fan-In

Use `parallel()` first, then summarize.

```ts
const reviews = await parallel({
  correctness: () => agent({
    id: "correctness",
    provider: "codex",
    prompt: "Review correctness."
  }),
  security: () => agent({
    id: "security",
    provider: "codex",
    prompt: "Review security."
  })
});

const summary = await agent({
  id: "summary",
  provider: "gemini",
  prompt: `Summarize:\n${JSON.stringify(reviews, null, 2)}`
});
```

### Pattern 5: Tool Integration

Use `tool()` to fetch data or perform operations, then pass the result to an agent.

```ts
const data = await tool({
  definition: "my-tool",
  args: { key: "value" }
});

const result = await agent({
  id: "process-tool-output",
  prompt: `Process: ${JSON.stringify(data)}`
});
```
