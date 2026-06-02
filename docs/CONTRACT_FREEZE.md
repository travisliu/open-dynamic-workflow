# Phase 0 — Contract Freeze

## Frozen MVP decisions

| Area | Decision |
| --- | --- |
| Workflow language | JavaScript-first runtime shape; TypeScript type contracts for implementation. |
| Agent invocation | Object-only `agent(input: AgentCallInput)`. |
| Parallel invocation | `parallel()` supports record and array task collections. |
| Providers | Built-in provider names are `mock`, `codex`, and `gemini`; unknown string providers remain representable for future extension. |
| `--provider` | Sets default provider only; does not override explicit per-agent provider. |
| Agent failures | Agent failures return `AgentFailureResult`; they are not thrown by default. |
| Fail-fast | Runtime option, default `false`. |
| Exclusions | No `pipeline()`, retries, worktree/container isolation, provider plugins, resumability, approval gates, shell capability, or provider-level concurrency in MVP contracts beyond extension points. |

## Shared contracts to preserve

- `AgentCallInput`
- `AgentResult`
- `AgentArtifacts`
- `WorkflowRunResult`
- `EventEnvelope`
- `AgentAdapter`
- `ProviderCommand`
- `ProviderParsedResult`
- `ProcessRunInput`
- `ProcessRunResult`
- `ArtifactStore`
- `Reporter`
- `ExecflowConfig`
- `SerializedError`

## Integration rule

Each implementation lane should build behind these interfaces. Runtime code must call adapters through the scheduler/registry boundary; adapters must not decide workflow failure policy; reporters consume events and final results only.
