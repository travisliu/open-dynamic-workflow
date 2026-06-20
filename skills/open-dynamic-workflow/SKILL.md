---
name: open-dynamic-workflow
description: Create, review, validate, and improve Open Dynamic Workflow workflow scripts that orchestrate Codex, Gemini, Cursor, and mock provider agents through agent(), parallel(), pipeline(), loop(), phase(), log(), workflow(), and tool().
---

# Purpose

Use this skill when the user wants Codex to create, review, debug, validate, or improve an Open Dynamic Workflow workflow script.

Open Dynamic Workflow is a local-first command-line workflow runner for orchestrating external coding-agent CLIs. A good Open Dynamic Workflow workflow expresses orchestration intent in a constrained JavaScript / TypeScript-like DSL, keeps provider behavior isolated, uses structured output where useful, and remains observable through reports and artifacts.

Use this skill for requests such as:

- Create an Open Dynamic Workflow workflow for code review, CI/CD, finance, accounting, research, migration checks, test triage, documentation review, or other repeatable multi-agent work.
- Convert an informal workflow idea into an Open Dynamic Workflow workflow file.
- Review an existing workflow for API correctness, validation errors, concurrency risks, provider selection, structured output, and CI usability.
- Explain how to run, validate, configure, or troubleshoot an Open Dynamic Workflow workflow.
- Refactor a workflow to use `parallel()` or `pipeline()` appropriately.
- Add iterative review/fix/verify behavior with `loop()` when a single stateful process should repeat until accepted, stopped, failed, timed out, or `maxRounds` is reached.

Do not use this skill when the user only wants a general explanation of agent orchestration, generic JavaScript help unrelated to Open Dynamic Workflow, or implementation work inside the Open Dynamic Workflow runtime itself unless the user explicitly asks to modify Open Dynamic Workflow.

# References

Consult these files when needed:

- `references/api-document.md`: Syntax reference for workflow file shape, `agent()`, `parallel()`, `pipeline()`, `loop()`, `phase()`, `log()`, `workflow()`, `tool()`, providers, reports, artifacts, exit codes, templates, and common validation mistakes.
- `references/cli-commands.md`: Command reference for `open-dynamic-workflow run`, `open-dynamic-workflow validate`, and `open-dynamic-workflow doctor`.
- `references/configuration.md`: Configuration reference for `.open-dynamic-workflow/config.yaml`, provider settings, security settings, reporting settings, and precedence rules.

When the user asks for exact syntax, validation constraints, command options, configuration behavior, or troubleshooting, prefer the references over memory.

# Workflow

When using this skill:

1. Clarify the user's workflow goal from the prompt.
   - Identify the domain, target inputs, expected outputs, providers, and whether the workflow is local, CI, or documentation-oriented.
   - If the user provides enough information, proceed without asking follow-up questions.

2. Choose the right Open Dynamic Workflow pattern.
   - Use a single `agent()` when one agent can complete the task.
   - Use `parallel()` when independent reviews or analyses can run concurrently and then be summarized.
   - Use `pipeline()` when many items must pass through the same ordered stages.
   - Use `loop()` when one stateful goal should repeat through serial rounds until completed, failed, timed out, cancelled, or maxRounds is reached.
   - Use fan-out / fan-in when multiple independent branches should be summarized by a final agent.

3. Draft valid workflow metadata first.
   - `export const meta = ...` must be the first top-level statement.
   - Include a static `name` and `description`.
   - Include `phases` when the workflow has meaningful milestones.
   - Use only static literal metadata values.

4. Write the workflow using only supported DSL primitives.
   - Use `agent()` for provider-backed tasks.
   - Use `parallel()` with task thunks, not already-started promises.
   - Use `pipeline()` with named stage objects.
   - Use `ctx.agent()` inside pipeline stage `run()` functions.
   - Use `loop({ label, initialState, options, run })` for iterative stateful work.
   - Use `ctx.agent()` and `ctx.workflow()` inside loop round callbacks.
   - Return `{ done: true, nextState }` to complete a loop successfully.
   - Use `phase()` to mark major progress points.
   - Use `log()` only for non-sensitive operational metadata.
   - Use `tool()` for invoking registered, deterministic tool definitions (only at workflow top level or inside a child workflow, not inside `parallel()`, pipeline stages, or loop rounds).

5. Select providers intentionally.
   - Use `codex` for correctness, security, code reasoning, implementation review, and safety checks.
   - Use `gemini` for test strategy, operations review, broad synthesis, summarization, and cross-perspective aggregation.
   - Use `cursor` for general coding-agent tasks, repo review, implementation planning, and optional autonomous changes.
   - Use `mock` for examples, deterministic CI checks, smoke tests, and workflows that must run without real credentials.
   - Let config or `--provider` provide defaults unless the workflow needs explicit per-agent provider choices.

6. Add structured output when downstream steps depend on machine-readable results.
   - Use JSON Schema for review findings, risk lists, plans, checklists, summaries, or classification output.
   - Keep schemas simple enough that providers can satisfy them reliably.
   - Set `structuredOutput: { transport: "auto" }` with `schema` unless there is a specific reason to choose another transport.
   - Use `transport: "prompt"` when you want schema instructions injected into the provider prompt explicitly.
   - Use `transport: "validate-only"` only when the prompt already contains exact output instructions and you only want local validation.
   - Do not use `transport: "native"` for current `codex`, `gemini`, `cursor`, or `mock` workflows; current adapters reject it.
   - Ask agents to return exactly one JSON object when a schema is required.

7. Set `permissions` only when the workflow requires autonomous execution.
   - Omit `permissions` for most workflows. Providers run with their configured approval behaviour by default.
   - Use `permissions: { mode: "dangerously-full-access" }` only when the agent must apply changes, write files, or execute commands without approval prompts.
   - Document the reason in a workflow comment when using `dangerously-full-access`.
   - Note the concrete per-provider effect: `codex` appends `--dangerously-bypass-approvals-and-sandbox`; `gemini` switches to `--approval-mode yolo`; `cursor` maps to the configured dangerous flag, default `--force`; `mock` records the field but has no runtime effect.

8. Make concurrency and failure behavior explicit when it matters.
   - Document expected `--concurrency`, `--timeout-ms`, and `--fail-fast` usage for CLI runs.
   - For `pipeline()`, choose `strategy`, `concurrency`, and `failFast` based on whether partial item failure should be tolerated.
   - For `loop()`, choose `maxRounds`, `failureMode`, and `timeoutMs` based on whether partial round failure should throw or settle.
   - Prefer item-tolerant behavior for analysis pipelines unless the user wants strict gating.

9. Add run instructions.
   - Include `open-dynamic-workflow validate <workflow-file>` before `open-dynamic-workflow run <workflow-file>`.
   - Include local commands and CI-friendly commands when relevant.
   - Suggest `--report json` for final machine-readable reports and `--report jsonl` for event streams.
   - Suggest `open-dynamic-workflow doctor` when provider availability or config may be uncertain.

10. Review the workflow before finalizing.
   - Check metadata placement.
   - Check that all agent calls return promises correctly.
   - Check that `parallel()` receives functions.
   - Check that `pipeline()` stages are named objects.
   - Check that pipeline stages use `ctx.agent()`.
   - Check that `loop()` has an initial state, a round callback, valid options, and a bounded `maxRounds`.
   - Check that loop rounds use `ctx.agent()` and `ctx.workflow()`, not top-level `agent()` for round-local provider work.
   - Check that `tool()` is only called at top level or inside child workflows, and uses valid/registered definition IDs.
   - Check that `tool()` is not called or aliased inside `parallel()` callbacks, pipeline stages, loop rounds, or shared-agent definitions.
   - Check for secrets in prompts/logs.
   - Check that `permissions` is only present where autonomous execution is explicitly intended, and that a comment explains why.
   - Check that the final result is exported.

11. Provide a concise explanation of how to use or adapt the workflow.

# Rules

- Do not invent unsupported Open Dynamic Workflow APIs.
- Do not use arbitrary imports, `require()`, filesystem APIs, process APIs, shell commands, or host capabilities inside workflow files (use `tool()` to invoke registered, trusted tool definitions for these operations).
- Do not place anything before `export const meta`.
- Do not use dynamic metadata values.
- Do not pass already-started promises into `parallel()`.
- Do not use anonymous callback shorthand as a pipeline stage.
- Do not call global `agent()` from inside a pipeline stage; use `ctx.agent()`.
- Do not call global `agent()` from inside a loop round when the work belongs to that round; use `ctx.agent()` and stable IDs such as `ctx.agentId("review")`.
- Do not call `tool()` inside `parallel()` callbacks, pipeline stages, loop rounds, or `defineAgent.run()`.
- Do not write unbounded loops. Use `loop()` with explicit, required `maxRounds`; the global ceiling is configured by `workflow.maxLoopRounds` (default 20).
- Do not assume automatic patch application, automatic commits, automatic merge, approval gates, DAG pipelines, retries, worktree isolation, container isolation, distributed execution, or resumable runs are available unless explicitly implemented.
- Do not log secrets, tokens, credentials, full private source dumps, or unnecessary raw provider output.
- Only set `permissions: { mode: "dangerously-full-access" }` when the workflow explicitly requires autonomous execution without approval prompts. Document the reason in a workflow comment adjacent to the agent call.
- Prefer explicit, reusable workflow files over vague prompts.
- Prefer validation and dry-run commands before real provider execution.
- Keep workflow scripts provider-agnostic except for intentional provider selection in `agent()` calls.
- In CI examples, prefer deterministic `mock` provider where the goal is smoke testing the workflow shape rather than getting real model output.
- When using `schema`, include `structuredOutput` only with supported transports: `"auto"`, `"prompt"`, or `"validate-only"` for current providers.

# Output format

When creating a workflow, return:

## Workflow

A complete Open Dynamic Workflow workflow file in a JavaScript code block.

## How to run

Commands to validate, dry-run if useful, run locally, and run in CI.

## Design notes

Brief notes explaining the selected pattern, providers, concurrency, structured outputs, and failure behavior.

## Validation checklist

A short checklist of Open Dynamic Workflow-specific correctness checks.

When reviewing a workflow, return:

## Summary

Overall assessment and risk level.

## Findings

For each issue:

- Severity: Critical, High, Medium, or Low
- Location:
- Problem:
- Why it matters:
- Suggested fix:

When reviewing security-related issues, explicitly check:

- Secrets or sensitive values in prompts or `log()` calls.
- Use of `permissions: { mode: "dangerously-full-access" }` without a documented reason.
- Provider choices that do not match the task risk level.

## Corrected workflow

Include a corrected workflow only when the user asks for edits or when the fix is short enough to be useful.

## Commands to verify

List validation and run commands.

# Optional scripts

Use these helper scripts when relevant and available:

- `scripts/open-dynamic-workflow-validate.sh`: Validate one or more workflow files with `open-dynamic-workflow validate`.
- `scripts/open-dynamic-workflow-smoke-run.sh`: Run a workflow with the mock provider and JSON report mode for deterministic smoke testing.

These scripts are optional helpers. If they do not fit the repository, show equivalent commands instead.

# Examples

## Example request: create a parallel review workflow

User request:

```text
Create an Open Dynamic Workflow workflow that uses Codex to review correctness and security while Gemini reviews tests and operations, then Gemini summarizes the results.
```

Example response workflow:

```ts
export const meta = {
  name: "parallel-pr-review",
  description: "Run parallel correctness, security, test, and operations reviews, then summarize the results.",
  phases: ["review", "summarize"]
};

phase("review");

const reviews = await parallel({
  correctness: () => agent({
    id: "correctness-review",
    provider: "codex",
    prompt: "Review the change for correctness bugs, edge cases, and regression risks."
  }),

  security: () => agent({
    id: "security-review",
    provider: "codex",
    prompt: "Review the change for authentication, authorization, data exposure, and injection risks."
  }),

  tests: () => agent({
    id: "test-review",
    provider: "gemini",
    prompt: "Review the test plan and identify missing coverage or brittle tests."
  }),

  operations: () => agent({
    id: "operations-review",
    provider: "gemini",
    prompt: "Review operational risks, rollout risks, observability gaps, and rollback concerns."
  })
});

phase("summarize");

const summary = await agent({
  id: "review-summary",
  provider: "gemini",
  prompt: `Summarize these review results, deduplicate findings, and provide a merge recommendation:\n${JSON.stringify(reviews, null, 2)}`
});

export default {
  reviews,
  summary
};
```

## Example request: create a pipeline workflow

User request:

```text
Create a workflow that processes several documents through extract, assess, and summarize stages.
```

Example response workflow:

```ts
export const meta = {
  name: "document-risk-pipeline",
  description: "Process documents through extraction, risk assessment, and summary stages.",
  phases: ["analyze", "summarize"]
};

const documents = [
  "contracts/vendor-a.md",
  "contracts/vendor-b.md",
  "contracts/vendor-c.md"
];

phase("analyze");

const itemResults = await pipeline(
  documents,
  [
    {
      name: "extract-obligations",
      run: (documentPath, ctx) => ctx.agent({
        id: ctx.agentId("extract"),
        provider: "codex",
        prompt: `Extract obligations, deadlines, and risk-bearing clauses from ${documentPath}.`,
        schema: {
          type: "object",
          properties: {
            document: { type: "string" },
            obligations: { type: "array", items: { type: "string" } },
            risks: { type: "array", items: { type: "string" } }
          },
          required: ["document", "obligations", "risks"]
        },
        structuredOutput: {
          transport: "auto"
        }
      })
    },
    {
      name: "assess-risk",
      run: (extraction, ctx) => ctx.agent({
        id: ctx.agentId("risk"),
        provider: "codex",
        prompt: `Assess the severity and business impact of this extraction:\n${JSON.stringify(extraction, null, 2)}`
      })
    },
    {
      name: "summarize-item",
      run: (riskAssessment, ctx) => ctx.agent({
        id: ctx.agentId("summary"),
        provider: "gemini",
        prompt: `Create an executive summary for this assessment:\n${JSON.stringify(riskAssessment, null, 2)}`
      })
    }
  ],
  {
    label: "document-risk-pipeline",
    strategy: "item-streaming",
    concurrency: 3,
    failFast: false
  }
);

phase("summarize");

const summary = await agent({
  id: "portfolio-summary",
  provider: "gemini",
  prompt: `Create a portfolio-level summary from these item results:\n${JSON.stringify(itemResults, null, 2)}`
});

export default {
  itemResults,
  summary
};
```

## Example request: create an iterative loop workflow

User request:

```text
Create a workflow that repeatedly reviews a plan, asks another agent to improve it, and stops when verification accepts it.
```

Example response workflow:

```ts
export const meta = {
  name: "review-fix-verify-loop",
  description: "Iteratively review, improve, and verify a plan until accepted or max rounds is reached.",
  phases: ["iterate", "summarize"]
};

phase("iterate");

const loopResult = await loop({
  label: "plan-review-loop",
  initialState: {
    plan: "Initial migration plan",
    remainingIssues: []
  },
  options: {
    maxRounds: 5,
    failureMode: "throw"
  },
  run: async (state, ctx) => {
    const review = await ctx.agent({
      id: ctx.agentId("review"),
      provider: "codex",
      prompt: `Review this plan and remaining issues:\n${JSON.stringify(state, null, 2)}`
    });

    const improvement = await ctx.agent({
      id: ctx.agentId("improve"),
      provider: "gemini",
      prompt: `Improve the plan based on this review:\n${JSON.stringify(review, null, 2)}`
    });

    const verification = await ctx.agent({
      id: ctx.agentId("verify"),
      provider: "codex",
      prompt: `Return JSON with accepted, reason, remainingIssues, and revisedPlan:\n${JSON.stringify(improvement, null, 2)}`,
      schema: {
        type: "object",
        properties: {
          accepted: { type: "boolean" },
          reason: { type: "string" },
          remainingIssues: { type: "array", items: { type: "string" } },
          revisedPlan: { type: "string" }
        },
        required: ["accepted", "reason", "remainingIssues", "revisedPlan"]
      },
      structuredOutput: { transport: "auto" }
    });

    const accepted = verification.json?.accepted === true;
    const nextState = {
      plan: verification.json?.revisedPlan ?? state.plan,
      remainingIssues: verification.json?.remainingIssues ?? state.remainingIssues
    };

    return {
      done: accepted,
      nextState
    };
  }
});

phase("summarize");

export default {
  loopResult
};
```

## Example commands

```bash
open-dynamic-workflow doctor
open-dynamic-workflow validate workflows/parallel-pr-review.js
open-dynamic-workflow run workflows/parallel-pr-review.js --provider mock --dry-run
open-dynamic-workflow run workflows/parallel-pr-review.js --provider codex --concurrency 4 --timeout-ms 900000
open-dynamic-workflow run workflows/parallel-pr-review.js --provider mock --report json
open-dynamic-workflow run workflows/parallel-pr-review.js --report jsonl
```

# Quality checklist

Before returning a final Open Dynamic Workflow workflow, confirm:

- `meta` is first and static.
- The workflow exports a final result.
- `phase()` names match declared phases when phases are declared.
- `parallel()` receives functions, not promises.
- `pipeline()` stages are named objects.
- Pipeline stages call `ctx.agent()`.
- `loop()` uses a bounded, required `maxRounds`, round-local `ctx.agent()` calls, and returns `{ done, nextState }` to control execution.
- Provider choices are intentional and explainable.
- Structured output schemas are valid JSON Schema objects.
- Structured output uses a supported transport: `auto`, `prompt`, or `validate-only`.
- `permissions: { mode: "dangerously-full-access" }` is only present where autonomous execution is explicitly intended, and a comment in the workflow explains why.
- CLI commands include validation before execution.
- Config assumptions are stated clearly.
- No unsupported APIs or out-of-scope capabilities are used.
