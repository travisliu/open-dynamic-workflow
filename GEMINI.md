# AGENTS.md

## Purpose

This file provides repository-specific guidance for Codex CLI and other coding agents working on ExecFlow.

ExecFlow is a local-first workflow CLI that orchestrates external coding-agent CLIs such as `codex exec`, `gemini -p`, and the MVP `mock` provider. ExecFlow itself must not implement a coding agent. It provides orchestration, scheduling, provider adapters, structured validation, reporting, and durable artifact capture around external tools.

Keep this file focused and practical. Follow the MVP scope unless the user explicitly asks for post-MVP design work.


## Architectural rules

Respect these boundaries when changing code:

1. Workflow runtime must not spawn provider processes directly.
2. Runtime schedules agent work through the scheduler.
3. Scheduler invokes provider adapters through controlled interfaces.
4. Provider adapters build commands and parse provider output; they do not decide workflow failure policy.
5. Process runner is provider-agnostic and owns process spawning, stdout/stderr streaming, timeout handling, and abort handling.
6. Structured output validation is local and provider-independent.
7. Reporters consume events and final results; they do not control execution.
8. Artifact storage is always enabled and central to debugging.
9. Security-sensitive behavior must be explicit, documented, and safe by default.
10. Keep provider-specific logic out of workflow DSL semantics.

## Recommended repository structure

Use this structure unless there is already a more specific structure in the repository:

```text
execflow/
  package.json
  tsconfig.json
  src/
    index.ts
    cli/
      index.ts
      commands/
        run.ts
        validate.ts
        doctor.ts
    config/
      load.ts
      schema.ts
      defaults.ts
    workflow/
      load.ts
      parse.ts
      validate.ts
      runtime.ts
      dsl.ts
      sandbox.ts
    orchestration/
      scheduler.ts
      event-bus.ts
      budget.ts
    agents/
      types.ts
      registry.ts
      process-runner.ts
      mock.ts
      codex-exec.ts
      gemini-cli.ts
    structured/
      extract-json.ts
      validate-json.ts
      schema.ts
    artifacts/
      run-store.ts
      manifest.ts
      logs.ts
    output/
      events.ts
      reporter.ts
      pretty-reporter.ts
      json-reporter.ts
      jsonl-reporter.ts
    errors/
      types.ts
      serialize.ts
      exit-codes.ts
  workflows/
    parallel-review.ts
  tests/
    unit/
    integration/
    fixtures/
```

If a requested change targets Phase 0, focus on shared contracts, CLI routing skeletons, and exit-code mapping rather than implementing runtime behavior.

## Coding standards

- Use TypeScript.
- Prefer small modules with explicit interfaces.
- Keep public contracts in stable files under `src/types/`, `src/agents/types.ts`, or similarly named contract files.
- Prefer discriminated unions for success/failure results.
- Use explicit `unknown` instead of `any` unless unavoidable.
- Keep provider command construction deterministic and fixture-testable.
- Do not print secrets or raw environment values.
- Do not introduce production dependencies without a clear reason.
- Avoid broad abstractions until a concrete MVP use case needs them.
- Preserve raw provider stdout and stderr even when parsing fails.

## Security rules

- Do not claim the MVP is a complete sandbox.
- Shell execution is unavailable in MVP workflow code.
- Arbitrary workflow imports are unavailable.
- Environment variables are not passed unless allowlisted.
- Redact secret-like values from terminal output, reports, events, and logs where feasible.
- Never apply patches automatically.
- Never introduce shared writable parallel execution as a default.

Redact at least:

```text
*_KEY
*_TOKEN
*_SECRET
PASSWORD
OPENAI_API_KEY
GEMINI_API_KEY
GOOGLE_API_KEY
```

## Testing expectations

Before considering a change complete, run the most specific tests available. For MVP work, prefer tests that do not require real provider credentials.

Expected test coverage:

- Type checking
- Linting, if configured
- Config loading and precedence
- Metadata parsing
- Workflow validation restrictions
- Event sequencing
- Artifact path generation
- JSONL append behavior
- Error serialization
- Process timeout behavior
- Mock provider behavior
- Provider command construction fixtures
- JSON Schema validation success and failure
- JSON and JSONL reporter output cleanliness

Suggested commands, depending on repository setup:

```bash
npm run typecheck
npm test
npm run lint
```

If the package uses pnpm or another package manager, use the repository's existing lockfile and scripts.

## Git and change-management rules

- Make focused changes.
- Do not reformat unrelated files.
- Do not update dependency versions unless required by the task.
- Do not commit secrets, provider credentials, `.execflow/runs/`, or local `.codex` logs.
- Keep generated artifacts out of source control unless they are intentional fixtures.
- When adding public behavior, update tests and examples.
- When changing contracts, update all affected modules and tests in the same change.

## Documentation rules

When changing user-visible behavior, update the relevant README or docs.

Document:

- CLI options
- Config fields
- Exit codes
- Artifact layout
- Reporter behavior
- Provider assumptions
- Security limitations

Avoid documenting post-MVP features as available behavior.

## Completion checklist for agents

Before finishing a task, verify:

- The change stays within MVP scope unless explicitly requested.
- Provider-specific behavior is isolated to adapters.
- Runtime does not spawn processes directly.
- Process runner remains provider-agnostic.
- Artifacts are preserved on failure paths.
- JSON and JSONL reporter stdout remain machine-readable.
- Secrets are not logged.
- Tests or fixtures cover the changed behavior.
- Documentation is updated for user-visible changes.