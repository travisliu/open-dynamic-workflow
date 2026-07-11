# Open Dynamic Workflow Skill References

This directory contains reference material used by the `open-dynamic-workflow` skill. Open Dynamic Workflow uses a zero-install model where tools do not require a dependency on the `@travisliu/open-dynamic-workflow` package, and instead leverage a locally generated declaration file (`.open-dynamic-workflow/globals.d.ts`) for type resolution.

- `api-document.md`: Workflow DSL including `loop()`, registered tool definitions, providers, reports, artifacts, examples, and validation mistakes. Defines the run-scoped global `context` binding and its distinction from operational callback `ctx`.
- `cli-commands.md`: `open-dynamic-workflow run`, `open-dynamic-workflow validate` (including verbose legacy diagnostics), and `open-dynamic-workflow doctor` commands and options.
- `configuration.md`: Config loading, workflow limits such as `workflow.maxLoopRounds`, provider settings, security settings, reporting, and precedence.
