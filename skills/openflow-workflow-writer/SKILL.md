---
name: openflow-workflow-writer
description: Write and revise OpenFlow dynamic workflow scripts for deterministic Codex multi-agent orchestration.
---

# OpenFlow Dynamic Workflows

Use this skill when the user explicitly wants an OpenFlow workflow, multi-agent orchestration, fan-out agents, a workflow script, or help revising/debugging an existing OpenFlow workflow.

A workflow structures work across many agents: to be comprehensive, to be confident, or to take on scale one context cannot hold. The script is where you encode that structure: what fans out, what verifies, what synthesizes.

Do not create a workflow merely because parallelism would be useful. For ordinary tasks, solve the task directly. If a workflow might help but the user has not opted in, briefly describe what the workflow could do and ask before authoring or running it.

The right move is often hybrid: scout inline first to discover the work-list, then write a workflow to pipeline over it. You do not need to know the shape before the task; you need to know it before the orchestration step.

# References

Read only what is needed:

- `references/api-document.md`: exact OpenFlow DSL syntax.
- `references/cli-commands.md`: run, validate, doctor, resume/cache, budget, background, and run observation commands.
- `references/configuration.md`: config defaults and provider settings.
- `references/codex-cli-setup.md`: Codex CLI readiness and real-run troubleshooting.

# Script Shape

Every workflow file must begin with `export const meta = {...}`:

```js
export const meta = {
  name: "review-changes",
  description: "Review changed files across dimensions and verify findings",
  phases: ["Review", "Verify", "Synthesize"]
};

phase("Review");
const findings = await agent("Find correctness risks.", { id: "find-correctness" });
```

The `meta` object must be a pure literal: no variables, function calls, spreads, or template interpolation. Required fields: `name`, `description`. Optional fields include `phases`, `version`, and `tags`. Use phase names that match `phase()` calls.

Scripts are plain JavaScript, not TypeScript. Use `await` directly at top level. Standard JS built-ins such as `JSON`, arrays, strings, and objects are available. No filesystem, Node.js, process, import, require, or shell access is available. `Date.now()`, `Math.random()`, and no-argument `new Date()` are rejected because they break resume/cache determinism.

# Script Body Hooks

## `agent(prompt, opts?)`

Spawn a Codex-backed agent.

```js
const text = await agent("Review this file for correctness risks.", {
  id: "correctness-review",
  label: "Correctness review"
});
```

Without `schema`, string-form `agent()` returns final text. With `schema`, it returns the validated JSON object. If `optional: true` is set and the call fails, it returns `null`; otherwise string-form failures throw and fail the workflow.

Use stable `id` values for expensive calls so resume/cache can match them later.

Use schema when downstream code needs structured data. Do not parse JSON by hand when a schema can express the contract.

```js
const result = await agent("Return exactly one JSON object with findings.", {
  id: "security-findings",
  schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            severity: { type: "string" },
            evidence: { type: "string" }
          },
          required: ["title", "severity", "evidence"]
        }
      }
    },
    required: ["findings"]
  },
  structuredOutput: { transport: "auto" }
});
```

Object form is supported for older workflows and returns a full `AgentResult`:

```js
const result = await agent({
  id: "legacy-review",
  prompt: "Review this.",
  provider: "mock"
});
```

## `agent.review(prompt, opts?)`

Run Codex review mode through `codex exec review`.

```js
const review = await agent.review("Review current uncommitted changes.", {
  id: "review-uncommitted",
  uncommitted: true
});
```

Use this for code-review shaped tasks. For ordinary analysis or synthesis, use `agent()`.

## `pause(id, opts)`

Stop a long workflow at a human decision point and let the caller resume later.

```js
const decision = await pause("approve-plan", {
  message: "Review the plan before implementation.",
  data: { plan }
});
```

Use `pause()` when the next step genuinely needs caller judgment, new constraints, approval, or a parameter change. Give every pause a stable non-empty id. If the input must be structured, add a JSON schema; `openflow resume` will require valid JSON and the workflow receives the parsed object.

Do not call `pause()` inside `parallel()` or inside a `pipeline()` stage. Put the pause at a top-level boundary before fan-out or after synthesis.

## `pipeline(items, stages, options?)`

Run each item through ordered stages. Default to pipeline for multi-stage work.

```js
const result = await pipeline(files, [
  {
    name: "scan",
    run: (file, ctx) => ctx.agent({
      id: ctx.agentId("scan"),
      prompt: `Scan ${file} for risky code.`
    })
  },
  {
    name: "verify",
    run: (scan, ctx) => ctx.agent({
      id: ctx.agentId("verify"),
      prompt: "Adversarially verify this scan:\n" + JSON.stringify(scan, null, 2)
    })
  }
], {
  strategy: "item-streaming",
  concurrency: 4,
  failFast: false
});
```

Use `ctx.agent()` inside stages. Do not call global `agent()` from a pipeline stage.

Prefer `strategy: "item-streaming"` when item A can move to a later stage while item B is still in an earlier stage. Use a barrier only when the next step genuinely needs all prior results together.

## `parallel(thunks)`

Run independent task thunks concurrently and wait for all results.

```js
const reviews = await parallel({
  correctness: () => agent("Review correctness.", { id: "review-correctness" }),
  security: () => agent("Review security.", { id: "review-security" }),
  tests: () => agent("Review tests.", { id: "review-tests" })
});
```

`parallel()` is a barrier. Use it only when tasks are independent and the next step needs their results together. Pass functions, not already-started promises.

## `phase(name)` and `log(message)`

Use `phase()` for major progress groups. Use `log()` for short progress notes, not secrets or large raw outputs.

## `args`

Use `args` to parameterize a workflow. Pass arrays and objects as actual values from the CLI or runner, not JSON-encoded strings.

# Default To Pipeline

Default to pipeline. Only reach for a barrier when you genuinely need all prior-stage results together.

A barrier is correct when stage N needs cross-item context from all of stage N-1:

- deduping or merging across a full result set before expensive downstream work
- early exit if the total count is zero
- a prompt that compares one finding against all other findings

A barrier is not justified by:

- needing to map, flatten, or filter
- stages being conceptually separate
- code looking cleaner with `await parallel(...)` in the middle

Smell test:

```js
const a = await parallel(...);
const b = transform(a);
const c = await parallel(...);
```

If `transform(a)` does not need cross-item context, rewrite it as a pipeline stage.

# Quality Patterns

Pick and compose patterns based on the task.

- **Adversarial verify**: spawn independent skeptics per finding, each prompted to refute. Keep only findings that survive.
- **Perspective-diverse verify**: use distinct lenses such as correctness, security, performance, reproducibility, and testability.
- **Judge panel**: generate independent attempts from different angles, score them, then synthesize from the winner while borrowing the best ideas from runners-up.
- **Loop-until-dry**: for unknown-size discovery, keep finding until consecutive rounds return nothing new.
- **Multi-modal sweep**: search different ways in parallel: by file, by content, by runtime path, by ownership, by time.
- **Completeness critic**: ask a final agent what is missing, unverified, or under-covered; use that as the next round of work.
- **No silent caps**: if a workflow samples, truncates, or bounds coverage, log what was dropped.

Scale to what the user asked for. Quick checks get a few agents. Thorough audits get a larger finder pool, verification, and synthesis. When unsure, lean thorough for research/review/audit and brief for quick checks.

# Canonical Review Pattern

Pipeline by default; each dimension verifies as soon as its review completes:

```js
export const meta = {
  name: "review-changes",
  description: "Review changed files across dimensions and verify findings",
  phases: ["Review", "Verify", "Synthesize"]
};

const DIMENSIONS = [
  { key: "bugs", prompt: "Find correctness bugs." },
  { key: "security", prompt: "Find security risks." },
  { key: "tests", prompt: "Find missing tests." }
];

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          evidence: { type: "string" }
        },
        required: ["title", "evidence"]
      }
    }
  },
  required: ["findings"]
};

phase("Review");
const reviewed = await pipeline(DIMENSIONS, [
  {
    name: "find",
    run: (dimension, ctx) => ctx.agent({
      id: ctx.agentId(dimension.key),
      prompt: dimension.prompt,
      schema: FINDINGS_SCHEMA,
      structuredOutput: { transport: "auto" }
    })
  },
  {
    name: "verify",
    run: (review, ctx) => ctx.agent({
      id: ctx.agentId("verify"),
      prompt: "Adversarially verify these findings:\n" + JSON.stringify(review, null, 2)
    })
  }
], {
  strategy: "item-streaming",
  failFast: false
});

phase("Synthesize");
const summary = await agent("Synthesize verified findings:\n" + JSON.stringify(reviewed, null, 2), {
  id: "summary"
});

export default { reviewed, summary };
```

When a barrier is correct, use it intentionally:

```js
const all = await parallel(DIMENSIONS.map(d => () =>
  agent(d.prompt, { id: `find-${d.key}`, schema: FINDINGS_SCHEMA })
));

const deduped = all
  .filter(Boolean)
  .flatMap(r => r.findings)
  .filter((finding, index, arr) =>
    arr.findIndex(other => other.title === finding.title) === index
  );

const verified = await parallel(deduped.map((finding, index) => () =>
  agent("Verify this finding:\n" + JSON.stringify(finding, null, 2), {
    id: `verify-${index}`
  })
));
```

# Loops

Loop-until-count:

```js
const bugs = [];
while (bugs.length < 10) {
  const result = await agent("Find more bugs.", {
    id: `find-bugs-${bugs.length}`,
    schema: BUGS_SCHEMA
  });
  bugs.push(...result.bugs);
  log(`${bugs.length}/10 found`);
}
```

Loop-until-dry:

```js
const seen = new Set();
const confirmed = [];
let dry = 0;

while (dry < 2) {
  const found = await parallel(FINDERS.map((finder, index) => () =>
    agent(finder.prompt, { id: `finder-${dry}-${index}`, schema: BUGS_SCHEMA })
  ));
  const fresh = found
    .filter(Boolean)
    .flatMap(r => r.bugs)
    .filter(bug => !seen.has(bug.key));

  if (!fresh.length) {
    dry += 1;
    continue;
  }

  dry = 0;
  fresh.forEach(bug => seen.add(bug.key));
  confirmed.push(...fresh);
}
```

Dedup against all seen, not only confirmed, or rejected findings can reappear forever.

# Resume

Resume/cache is based on the workflow hash plus stable agent call fingerprints. Give important calls stable ids. Re-run with:

```bash
openflow run workflow.js --resume <runId>
```

Same workflow plus same agent call inputs should hit cache. Edited or new calls run live.

For a pending workflow, continue with:

```bash
openflow resume <runId> "next instruction"
```

The resume command creates a new run, replays the workflow, hits cache for completed pre-pause agents, returns the supplied pause input, and continues. The old pending run remains as an audit record.

For loops, stable ids are mandatory if you want resume/cache to behave well:

```js
for (let round = 1; round <= 3; round++) {
  const fix = await agent("Fix round " + round, { id: `fix-${round}` });
  await agent("Review round " + round + ":\n" + fix, { id: `review-${round}` });
}
```

Long or open-ended loops should use explicit `maxRounds`, token/call budgets, or periodic top-level `pause()` checkpoints.

# Output Requirements

When creating a workflow, provide:

- the complete workflow file
- commands to validate and run it
- concise notes about the orchestration shape and failure behavior

When reviewing a workflow, lead with findings ordered by severity, then provide corrected code only when useful.
