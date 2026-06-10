# Agent CLI Adapter Protocol

Status: proposal

This document proposes a provider-neutral adapter protocol for coding-agent
CLIs. It is intentionally a design note, not an implementation patch. The goal
is to make future provider work easier to review by first agreeing on the small
set of concepts OpenFlow needs from any external agent CLI.

## Motivation

OpenFlow already has a useful adapter shape:

```ts
interface AgentAdapter {
  name: ProviderName;
  checkHealth?(): Promise<ProviderHealth>;
  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;
  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}
```

That is enough for simple command execution, but modern agent CLIs expose
different combinations of capabilities:

- machine-readable JSON or JSONL events
- native JSON Schema output
- token and cost usage events
- sessions, resume, fork, and ephemeral modes
- sandbox, approval, and tool permission controls
- terminal error events that may appear even when the process exits with code 0
- background or server modes that are not always appropriate for a one-shot run

The proposed protocol keeps workflow code provider-neutral while allowing each
adapter to declare what it can actually support.

## Design Goals

- Keep OpenFlow provider-neutral.
- Preserve the existing workflow API and adapter direction.
- Treat provider features as optional capabilities, not as universal behavior.
- Let adapters report provider facts; keep workflow policy in OpenFlow.
- Avoid token prediction. Usage budgets should use observed provider usage only.
- Keep resume/cache independent from provider session resume.
- Support incremental implementation with a fake adapter test suite first.

## Non-Goals

- This proposal does not make Codex, OpenCode, Copilot, Pi, or Antigravity the
  default provider.
- This proposal does not require every provider to support sessions, usage,
  native schemas, or sandbox controls.
- This proposal does not introduce a daemon, TUI, remote server, or worktree
  isolation.
- This proposal does not ask OpenFlow to estimate token usage.

## Observed CLI Capability Matrix

The table is based on local CLI help where available and public documentation.
It should be treated as an implementation guide, not a permanent compatibility
promise.

| Provider CLI | One-shot run | Machine output | Native schema | Usage facts | Sessions | Permission controls | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex exec` | `--json` JSONL and `-o` last message | `--output-schema` | JSONL events can include usage | `exec resume`, interactive resume/fork, `--ephemeral` | sandbox and approval flags | Strong fit for one-shot OpenFlow agents. |
| OpenCode | `opencode run` | `--format json` event stream | not clearly exposed as a run flag | `step_finish.tokens` and cost events | `--continue`, `--session`, `--fork`, export/session commands | agent/config/tool permissions, provider dependent | Adapter must detect error events even if exit code is 0. |
| Copilot CLI | programmatic prompt mode | plain text and ACP NDJSON | not clearly exposed as a generic schema flag | may require telemetry or command-specific parsing | session support via CLI/ACP surfaces | allow/deny style tool permission flags | Useful, but should start as a conservative adapter. |
| Pi Agent | print mode, JSON mode, RPC mode, SDK-style embedding | JSON events and RPC | not clearly exposed as a generic schema flag | provider/event dependent | sessions and no-session modes | trust and approval modes | Strong fit for a future embedded adapter, but larger surface. |
| Antigravity | `antigravity chat` opens an agent chat | no stable one-shot JSON contract observed in local help | not observed | not observed | editor/profile/window state | editor/profile modes | Best treated as experimental until a stable headless contract is confirmed. |

## Proposed Types

The existing `AgentAdapter` can remain the entry point. The main addition is a
capability declaration and a richer parsed result.

```ts
interface AgentCliCapabilities {
  prompt: {
    transports: Array<"stdin" | "argv" | "file">;
  };
  output: {
    formats: Array<"text" | "json" | "jsonl" | "last-message-file" | "session-export">;
    terminalErrorEvents?: boolean;
  };
  structuredOutput: {
    modes: Array<"prompt" | "validate-only" | "native-json-schema">;
  };
  usage: {
    source: "none" | "final-event" | "session-export" | "telemetry";
    hasCost?: boolean;
  };
  sessions: {
    modes: Array<"none" | "ephemeral" | "resume" | "fork">;
  };
  permissions: {
    modes: Array<"none" | "sandbox" | "approval" | "tool-allowlist" | "profile">;
  };
}

interface ProviderFailure {
  name: string;
  message: string;
  code: "PROVIDER_PROCESS_FAILED" | "PROVIDER_REPORTED_FAILURE" | "PROVIDER_PARSE_FAILED";
  retryable?: boolean;
  raw?: unknown;
}

interface AgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

interface ProviderParsedResult {
  text?: string;
  json?: unknown;
  structuredJson?: unknown;
  raw?: unknown;
  parseWarnings?: string[];
  usage?: AgentUsage;
  providerSessionId?: string;
  providerThreadId?: string;
  providerMetadata?: Record<string, unknown>;
  failure?: ProviderFailure;
}

interface AgentAdapter {
  name: ProviderName;
  capabilities?(): AgentCliCapabilities;
  checkHealth?(): Promise<ProviderHealth>;
  buildCommand(input: AgentRunInput): Promise<ProviderCommand>;
  parseResult(input: ProviderParseInput): Promise<ProviderParsedResult>;
}
```

## Execution Semantics

OpenFlow should keep its current process-runner ownership:

1. The workflow runtime schedules an agent call.
2. The adapter builds the provider invocation.
3. OpenFlow runs the process, captures stdout/stderr, and writes artifacts.
4. The adapter parses provider-specific output.
5. OpenFlow applies provider-neutral policy: failure handling, schema
   validation, cache writes, budget checks, reporting, and events.

One change is important: `parseResult()` should be allowed to report a provider
failure even when the process exit code is 0. Some CLIs emit structured terminal
error events in stdout while still returning success from the shell process.

Recommended precedence:

1. timeout or OpenFlow cancellation
2. provider parse failure from `parseResult().failure`
3. non-zero process exit
4. schema validation failure
5. success

The exact precedence can be adjusted during implementation, but provider
terminal errors must not be hidden by a zero exit code.

## Structured Output

OpenFlow should model structured output in layers:

1. `native-json-schema`: adapter passes a schema to the provider if supported.
2. `prompt`: OpenFlow injects schema instructions into the prompt.
3. `validate-only`: OpenFlow validates whatever structured JSON the adapter
   can parse, without modifying the prompt.

Adapters declare which modes they support. OpenFlow can choose the best mode
for `structuredOutput.transport = "auto"` and reject unsupported explicit modes.

## Usage and Budgets

Adapters should only report observed provider facts. They should not estimate
tokens.

OpenFlow can aggregate `AgentUsage` into a workflow-level summary and implement
soft budgets:

- max observed tokens: checked after an agent reports usage
- max agent calls: checked before scheduling a new provider call
- max run time: checked by OpenFlow wall-clock timers

`totalTokens` should prefer a provider-reported total. If no total is reported,
OpenFlow may compute `inputTokens + outputTokens` and must avoid double-counting
cached input tokens.

## Resume and Cache

Provider session resume and OpenFlow cache are different features.

Provider session resume:

- continues a provider-owned conversation or thread
- may depend on provider-local state
- can change behavior even for the same prompt

OpenFlow cache:

- reuses a successful agent result based on a stable call fingerprint
- belongs to OpenFlow artifacts
- should be safe across interrupted workflow runs
- should not require provider session support

The adapter protocol should expose provider session identifiers as metadata, but
cache reads/writes should stay in OpenFlow.

## Implementation Plan

If this direction is accepted, the first implementation PR should implement the
protocol as a complete minimum slice:

1. Add capability types, usage types, provider failure types, and result
   metadata fields.
2. Update `DefaultAgentExecutor` to parse provider output before final success
   classification when needed.
3. Add a fake adapter test suite covering text output, JSONL output, terminal
   error events, usage events, native-schema capability negotiation, and missing
   capabilities.
4. Keep existing mock, Codex, and Gemini behavior compatible.
5. Add one real adapter improvement, preferably Codex, as the first proof that
   the protocol is useful.

Follow-up PRs can then add OpenCode, Pi, or more advanced provider support
without redesigning the executor contract.

## Suggested Test Coverage

- capability declarations are stable and serializable
- unsupported explicit structured-output modes fail with a CLI usage error
- `auto` structured-output mode chooses native schema when available
- provider terminal error events become failed agent results
- zero exit with provider failure does not report success
- non-zero exit without provider parsed failure remains a process failure
- usage fields normalize snake_case and camelCase provider payloads
- usage aggregation does not double-count cached input tokens
- cache fingerprints do not include provider session ids by default
- provider session ids are preserved in artifacts and reports

## References

- Codex non-interactive mode: https://developers.openai.com/codex/noninteractive
- Codex CLI local help: `codex --help`, `codex exec --help`
- OpenCode CLI reference: https://opencode.ai/docs/cli/
- OpenCode server and SDK docs: https://opencode.ai/docs/server/
- OpenCode local help: `opencode --help`, `opencode run --help`
- GitHub Copilot CLI programmatic docs: https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically
- GitHub Copilot CLI ACP docs: https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server
- Pi usage docs: https://pi.dev/docs/latest/usage
- Pi RPC docs: https://pi.dev/docs/latest/rpc
- Antigravity local help: `antigravity --help`, `antigravity chat --help`
- OpenFlow current adapter interface: `src/types/agent.ts`
