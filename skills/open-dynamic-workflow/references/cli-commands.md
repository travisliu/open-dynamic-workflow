# Open Dynamic Workflow CLI Commands

This document summarizes the command-line interface (CLI) commands and options for Open Dynamic Workflow.

---

## Initialize a project

Initializes a project for Open Dynamic Workflow by creating a recommended starter layout and configuration.

```bash
open-dynamic-workflow init [options]
```

### Generated Structure

By default, `open-dynamic-workflow init` creates:

```text
.open-dynamic-workflow/
  config.yaml       # Core project configuration
  globals.d.ts      # Standalone TS declaration file for global defineTool
  agents/           # Shared agents directory (empty)
  tools/            # Tools directory (empty)
    example.tool.ts # Starter tool template
workflows/
  example.workflow.ts # Starter workflow template
```

### Common options

```bash
--yes                      # Run non-interactively with defaults
--provider <name>          # Default provider for generated config
--force                    # Overwrite generated files if they already exist
--strict                   # Fail before writing if any target path already exists
--run-smoke-test           # Validate and run the generated example with mock
--report <pretty|json>     # Smoke-test report mode
--cwd <path>               # Project working directory
--workflows-dir <path>     # Generated workflows directory
--agents-dir <path>        # Shared agents directory
--tools-dir <path>         # Tools directory
```

### Examples

```bash
open-dynamic-workflow init
open-dynamic-workflow init --yes
open-dynamic-workflow init --yes --run-smoke-test
open-dynamic-workflow init --strict
open-dynamic-workflow init --force --provider codex
```

### Behavior

* **Interactive mode**: Default when stdin is a TTY. Prompts for provider selection and confirmation.
* **Non-interactive mode**: Triggered by `--yes` or non-TTY stdin. Uses defaults or requested options.
* **Mock fallback**: If a requested provider is not found in `PATH`, `init` offers a fallback to the `mock` provider.
* **Safety**: Does **not** modify `package.json`. Existing files are skipped unless `--force` is used.
* **Smoke test**: If `--run-smoke-test` is used, Open Dynamic Workflow performs a `validate` and real `run --provider mock` on the generated example workflow (`workflows/example.workflow.ts`), so it can create run artifacts.
* **Path configuration**:
  - Generated `config.yaml` explicitly includes `outDir: ".open-dynamic-workflow/runs"`. Ordinary `init` does not create or readiness-probe that root.
  - The generated `config.yaml` uses the new flat `include` / `exclude` arrays rather than legacy `dir` or `workflow.discovery` fields.
  - Suffix-specific patterns (e.g. `*.workflow.js`, `*.agent.ts`) are generated explicitly instead of using brace expansion.
  - `--workflows-dir`, `--agents-dir`, and `--tools-dir` options will customize both the created physical directories and their corresponding generated include patterns.

---

## Run a workflow

Runs a workflow by name or file path.

```bash
open-dynamic-workflow run <workflow-name-or-file>
```

### Resolution Rules

* **Path-like targets**: Targets containing `/`, starting with `./` or `../`, absolute paths, or ending with workflow extensions (`.ts`, `.js`, etc.) are resolved as file paths directly.
* **Bare targets**: Targets without path separators or extensions are resolved by exact `meta.name` first. If no name matches, Open Dynamic Workflow falls back to resolving the target as a file path relative to the `cwd`.
* **Duplicate names**: If multiple workflows in the discovery scope share the same `meta.name`, the command will fail with a listing of matching files.

Use `open-dynamic-workflow list workflows` to see runnable names and their resolved paths.

### Common options

| Option | Description |
| :--- | :--- |
| `--profile <name>` | Select a profile to run (e.g., `fast`, `deep`) from configuration or external catalog. |
| `--profiles <path>` | Path to an external YAML file containing profiles to load. |
| `--provider <name>` | Override the default provider reference; `<name>` may be a concrete provider or a configured alias. |
| `--model <name>` | Override the default model. |
| `--concurrency <num>` | Limit maximum parallel agent calls (integer >= 1). |
| `--timeout-ms <num>` | Timeout in milliseconds for workflow execution. |
| `--max-agent-calls <num>` | Limit the maximum number of live provider calls allowed, including retry attempts. |
| `--report <pretty\|json\|jsonl>` | Output formatting mode for stdout. |
| `--fail-fast` | Abort immediately on the first agent/task failure. |
| `--resume <run-id>` | Resume a previous run using cache replay. |
| `--dry-run` | Validate, resolve, and print a summary without providers or output-root writes. |
| `--config <path>` | Path to the YAML configuration file. |
| `--cwd <path>` | Current working directory to resolve workflows and configurations. |
| `--out <path>` | Artifact runs root (the parent of each `<runId>` directory). |
| `--thinking-effort <effort>` | Override the thinking effort level for all eligible agent calls. Must be one of: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. This is an execution preference and does not guarantee identical reasoning depth across different providers. Per-agent `thinkingEffort` values defined in the workflow script override this CLI value. If this resolves to a value unsupported by the selected provider, execution will fail. |
| `--retry-max-attempts <number>` | Override the global retry `maxAttempts` value. |
| `--retry-delay-ms <ms>` | Override the global retry initial delay in milliseconds. |
| `--retry-max-delay-ms <ms>` | Override the global retry maximum delay in milliseconds. |
| `--retry-backoff <fixed\|exponential>` | Override the global retry backoff strategy. |
| `--retry-disable-delay` | Disable retry delays for the run. |
| `--no-retry` | Disable global retry for the run. |
| `--strict` | Fail before loading when strict discovery or path diagnostics are present. By default, `run` is lenient for path diagnostics. |

### Examples

```bash
open-dynamic-workflow run review
open-dynamic-workflow run review --profile fast
open-dynamic-workflow run review --profiles custom-profiles.yaml --profile deep
open-dynamic-workflow run review --resume <previous-run-id> --profile custom-profile
open-dynamic-workflow run review --provider codex
open-dynamic-workflow run review --provider mock
open-dynamic-workflow run review --provider fast-review
open-dynamic-workflow run review --concurrency 2
open-dynamic-workflow run review --timeout-ms 600000
open-dynamic-workflow run review --max-agent-calls 20
open-dynamic-workflow run review --report json
open-dynamic-workflow run review --report jsonl
open-dynamic-workflow run review --fail-fast
open-dynamic-workflow run review --resume <previous-run-id>
open-dynamic-workflow run review --thinking-effort high
open-dynamic-workflow run review --retry-max-attempts 3
open-dynamic-workflow run review --retry-delay-ms 0 --retry-disable-delay
open-dynamic-workflow run review --no-retry
open-dynamic-workflow run review --strict
```

`--out` is the artifact **runs root**, not a single run directory. Each normal or continuation run writes a fresh `<runsRoot>/<runId>` directory. Its selection order is: current `--out`, selected profile's direct or inherited `outDir`, explicit top-level config `outDir`, then the built-in `.open-dynamic-workflow/runs` root. Relative roots resolve from active `--cwd`; absolute roots may be outside the project. `~`, `$VAR`, `%VAR%`, and template-looking text are literal paths, not expansions.

```bash
open-dynamic-workflow run review --profile ci
open-dynamic-workflow run review --out .artifacts/manual-runs
open-dynamic-workflow run review --dry-run --verbose --profile ci
```

Verbose output identifies the `Artifacts root`, `Output-root source`, and `Selected profile`. Selection and source are separate: a selected profile without its own or inherited `outDir` falls through to the global/default root.

`--dry-run` resolves configuration, profiles, and discovery without invoking providers. It never creates or probes the runs root and does not construct a current artifact store. When `--resume` is supplied it may perform a read-only previous-run lookup.

Retry flags adjust the global retry policy before workflow code runs. Per-agent `retry` settings still take precedence, followed by the selected alias retry policy. `--no-retry` cannot be combined with the other retry flags. Alias references are validated during configuration loading; unknown aliases and invalid alias inheritance fail with the normal workflow-validation exit code. Alias resolution metadata is included in JSON/JSONL output and resume artifacts.

---

## Resume a previous run

Runs a new workflow attempt from a previous run's recorded invocation and reuses cached agent results for the longest unchanged prefix.

```bash
open-dynamic-workflow resume <runId-or-path> [options]
```

### Common options

* `--out <path>`: Artifact runs root (optional).
* `--profile <name>`: Select a profile from the current configuration.
* `--report <mode>`: Output formatting mode (pretty, json, jsonl).
* `--max-agent-calls <num>`: Max agent calls limit override.

### Example

```bash
open-dynamic-workflow resume <previous-run-id>
```

### Behavior

Resume/cache is intentionally conservative. Open Dynamic Workflow replays the workflow script and compares each `agent()` call in order. A cached result is reused only while the prefix is unchanged: the call sequence must match, `id` or `label` must match when present, and the call fingerprint must match.

`open-dynamic-workflow resume` reuses the exact `workflowFile` recorded in the original run's `run-input.json`, even if the original run was started by name. This ensures deterministic replay even if name resolution would now point to a different file.

#### Profile, lookup, and destination rules

`open-dynamic-workflow run <workflow> --resume` uses only the current invocation's profile and root configuration. Standalone `resume` lets an explicit current `--profile` win; otherwise, after it finds the previous run, it may reuse a recorded **profile name** by resolving that name in the current configuration catalog. Standalone resume does not support external `--profiles`. Historical roots and resolved profile snapshots are audit-only.

Before a standalone resume can read the previous `run-input.json`, a bare target is looked up with current explicit `--out`/`--profile` when supplied, otherwise with the current global/default root. A bare ID checks at most two direct candidates: that effective root, then legacy `.open-dynamic-workflow/runs` when different. It does not search profile roots or history. Explicit relative and absolute paths are checked directly and never fall back. Every continuation writes a fresh directory below the current effective runs root, never into the prior run.

Use stable `id` values for loops, such as `id: \`round-${i}\``. Using `Date.now()`, `Math.random()`, and argument-free `new Date()` will trigger validation warnings (e.g., `Avoid Date.now(): it prevents deterministic resume/cache behavior. Use tool() instead.`) because they prevent deterministic replay. If you need non-deterministic values like timestamps or random numbers, wrap them in a custom `tool()` call so they are cached on the first run and replayed deterministically on subsequent runs.

---

## Validate a workflow

Validates a workflow by name or file path.

```bash
open-dynamic-workflow validate <workflow-name-or-file> [options]
```

### Common options

| Option | Description |
| :--- | :--- |
| `--config <path>` | Path to the YAML configuration file. |
| `--cwd <path>` | Custom working directory. |
| `--verbose` | Enable verbose logging. |
| `--strict` | Fail before loading when strict discovery or path diagnostics are present. By default, `validate` is lenient for path diagnostics. |
| `--profile <name>` | Select a profile from config or `--profiles`. |
| `--profiles <path>` | Load an external YAML profile catalog. |

### Examples

```bash
open-dynamic-workflow validate review
open-dynamic-workflow validate workflows/review.ts
open-dynamic-workflow validate review --verbose
open-dynamic-workflow validate workflows/review.ts --strict
```

### Validation checks include

* `meta` is the first top-level statement.
* `meta.name` and `meta.description` are present.
* Metadata is statically analyzable.
* Unsupported imports and restricted APIs are rejected.
* Supported `pipeline()` usage is accepted.
* Obviously invalid `pipeline()` usage is rejected.
* Static `loop()` call shapes and `LoopOptions` are checked.
* Static loop `maxRounds` values must be positive integers and must not exceed `workflow.maxLoopRounds` (default 20).
* Global `tool()` usage inside loop callbacks is rejected.
* Shared agent definitions configured via `sharedAgents.include` / `exclude` (or legacy `sharedAgents.dir` fallback) are loaded and validated.
* Verifies that `agent({ definition })` and `ctx.agent({ definition })` calls use string literal IDs that exist in the shared agent registry (when `sharedAgents.allowDynamicIds` is false).
* Tool definitions configured via `tools.include` / `exclude` (or legacy `tools.dir` fallback) are loaded and validated.
* Verifies that `tool({ definition })` calls use string literal IDs that exist in the tool registry.

Validation checks the configuration and profile `outDir` strings, but does not check their existence/writeability and does not create or probe a runs root.

---

## Check environment readiness

```bash
open-dynamic-workflow doctor [--profile <name>]
```

### Checks include

* config file can be loaded.
* The resolved global or selected-profile artifact runs root is checked. Doctor creates a missing root, rejects a file conflict, verifies access with an exclusive temporary probe, removes that probe, and reports the absolute path and reason.
* provider CLIs are present.
* `open-dynamic-workflow doctor` reports all built-in provider adapters.
* Missing optional provider CLIs (like `copilot`, `opencode`, `agy`, or `pi`) are shown as unavailable but do not cause the doctor command to fail unless they are the configured `defaultProvider`.
* Note: For `copilot`, the doctor command checks for the standalone `copilot` executable but does not perform authentication or login checks.
* provider commands can be executed.
* `secret-like environment values` are not printed.

Doctor supports `--profile` but not `--out` or `--profiles`; it checks the root selected by current configuration.

---

## List resources

```bash
open-dynamic-workflow list [resourceType]
```

List discoverable workflows, shared agents, and tools. `resourceType` can be `workflows`, `agents`, or `tools`. If omitted, all resources are listed.

### Common options

```bash
--dir <path>             # Directory to scan for targeted list commands
--workflows-dir <path>   # Directory to scan for workflows
--agents-dir <path>      # Directory to scan for shared agents
--tools-dir <path>       # Directory to scan for tools
-r, --report <mode>      # Output format (pretty, json, jsonl)
-v, --verbose            # Show extended metadata
--strict                 # Fail if any discovered file is invalid
-c, --config <path>      # Path to config file
--cwd <path>             # Project working directory
```

### Examples

```bash
open-dynamic-workflow list
open-dynamic-workflow list workflows
open-dynamic-workflow list agents --verbose
open-dynamic-workflow list tools --report json
open-dynamic-workflow list --strict
open-dynamic-workflow list workflows --dir examples/workflows
```

### Resource Discovery

* **Workflows**: Scanned using the glob patterns configured in `workflow.include` and filtered by `workflow.exclude` (defaults to `workflows/**/*.workflow.js` and `workflows/**/*.workflow.ts`).
* **Agents**: Scanned using the glob patterns configured in `sharedAgents.include` and filtered by `sharedAgents.exclude` (defaults to `.open-dynamic-workflow/agents/**/*.agent.js` and `.open-dynamic-workflow/agents/**/*.agent.ts`).
* **Tools**: Scanned using the glob patterns configured in `tools.include` and filtered by `tools.exclude` (defaults to `.open-dynamic-workflow/tools/**/*.tool.js` and `.open-dynamic-workflow/tools/**/*.tool.ts`).

#### Directory Overrides via CLI flags
If directory flags are supplied via the CLI (e.g., `--dir`, `--workflows-dir`, `--agents-dir`, `--tools-dir`), they dynamically override the active config's `include` patterns for the targeted resource type:
- They **replace** the target resource's include patterns with glob patterns pointing to the specified directory.
- They **preserve** the resource's configured exclude patterns.
- For example, `open-dynamic-workflow list workflows --dir examples/workflows` targets only workflows in the `examples/workflows` directory while respecting active workflow excludes.
- Unrelated resource types (e.g., agents and tools when querying all resources with `open-dynamic-workflow list --agents-dir custom-agents`) remain unchanged except for the targeted override.

The `list` command is lenient by default. It will report configuration warnings (such as legacy key usages) and discoverable resource errors but will exit with code `0` unless strict mode is enabled.
In strict mode (using the `--strict` flag), any fatal path configurations (like symlink escapes, directory-only includes, or out-of-workspace patterns) or resource errors will cause the command to exit with a non-zero exit code (3).

List validates configured root strings while loading configuration, but does not create, probe, or require existence/writeability of the artifact runs root.

---

## Shared Agent Loading & Security Policy

When executing `open-dynamic-workflow run` or `open-dynamic-workflow validate`, Open Dynamic Workflow resolves agent files using the patterns in `sharedAgents.include` / `exclude`. Legacy key `sharedAgents.dir` remains supported as a fallback during migration.
If a file contains unauthorized symbols or attempts host operations violating the validation restrictions, a `SHARED_AGENT_SECURITY_POLICY_VIOLATION` error is thrown, halting execution or validation immediately.
Literal shared agent IDs referenced in `agent({ definition })` or `ctx.agent({ definition })` are checked against this loaded registry.

---

## Tool Loading & Trust Model

When executing `open-dynamic-workflow run` or `open-dynamic-workflow validate`, Open Dynamic Workflow resolves tool files using the patterns in `tools.include` / `exclude` (with legacy fallback to `tools.dir` supported during migration).

Tool files are treated as trusted runtime extensions. They may execute unrestricted JavaScript with host access (e.g., read/write files, execute shell commands, import packages, or perform network requests).

Before they are imported at runtime, tool metadata is statically discoverable. Commands like `list tools`, `validate`, `run`, and `doctor` enforce the exact same static metadata contract:
* All tool entrypoints must default-export `defineTool({ ... })`.
* Static property values like `id`, `description`, `inputSchema`, optional `outputSchema`, optional `defaultTimeoutMs`, and optional `metadata` are validated statically.
* Same-file earlier `const` declaration fragments and static property access (e.g., `SCHEMA.properties`) are supported.
* Imported, forward-referenced, spread, or computed metadata/schema values are unsupported.
* Invalid definitions fail consistently with `TOOL_INVALID_DEFINITION`.
* Duplicate tool IDs fail consistently with `TOOL_DUPLICATE_DEFINITION` (or the corresponding CLI duplicate error) before execution begins.
Individual `tool({ definition })` calls are checked statically during validation to ensure they reference a registered tool ID.

### Legacy Tool Diagnostic

When running `validate` or `run` with `--verbose` (or with `reporting.verbose: true` in config), Open Dynamic Workflow scans tool implementations for legacy imports from `@travisliu/open-dynamic-workflow`.
If a legacy import is detected, the CLI writes an informational diagnostic message to `stderr`:
`Legacy ODW defineTool import detected in <path>; it remains supported, but new tools should use global defineTool without an import.`

This diagnostic is:
* **Informational only**: It does not change the command exit status, error codes, or success/failure results.
* **Separated from stdout**: It is written to `stderr` and does not affect `stdout` outputs. In JSON or JSONL report modes, `stdout` remains fully machine-readable and parseable.

---

## Initialization Hints

When the default project configuration file (`.open-dynamic-workflow/config.yaml`) is missing and a command fails or produces a diagnostic due to missing setup/resources, the CLI attaches an informational initialization hint:

*   **List command**: If discovery directories are missing, `list` prints the diagnostics alongside the hint suggesting to run `init`. By default, `list` runs leniently and exits successfully; the hint is strictly informational. In strict mode (`--strict`), the command still exits with the strict non-zero exit code.
*   **Validate / Run commands**: If setup fails before execution (preflight) because a shared agent or child workflow cannot be resolved, the CLI prints the setup error and the hint.
*   **Output formatting details**:
    *   For the `list` command:
        *   In pretty mode, the hint is rendered inline on `stdout` indented under the matching diagnostic (prefixed with `    Hint: `).
        *   In `json` and `jsonl` modes, the hint is preserved inside the emitted diagnostic objects (under the `hint` field) written to `stdout`.
    *   For the `validate` and `run` commands:
        *   In pretty mode, the error and the hint (prefixed with `Hint: `) are printed to `stderr`.
        *   In `json` and `jsonl` modes, preflight setup failures write exactly one parseable JSON/JSONL error envelope containing `error.hint` to `stdout`, and no human-readable error messages are written to `stdout` or `stderr`.

Initialization is optional: if no config file exists, the system automatically falls back to built-in defaults. Explicitly specifying a custom configuration path using `--config` suppresses the initialization hint unless that path resolves to the default project configuration path.

---

## Profile Output Surfaces

Profile selection information is reported across three main output surfaces, each displaying only compact metadata to prevent credential leakage:

* **Pretty Summary Line**: Appears in `Summary` after duration/limits:
  * Config case: `  profile:   fast (config)`
  * External catalog case: `  profile:   deep (external: path.yaml)`
  * External override case: `  profile:   deep (external override: path.yaml)`
  * Resumed/Recorded case: `  profile:   fast (reused from recorded run input)`
* **JSON final-result `profile` key**: Optional compact metadata containing selection, source, optional path, hash, and optional resumed marker:
  ```json
  "profile": {
    "selected": "fast",
    "source": "config",
    "hash": "sha256:..."
  }
  ```
* **JSONL `profile.resolved` event**: Emitted before workflow execution starts, carrying the same compact metadata:
  ```json
  {"schemaVersion":"open-dynamic-workflow.event.v1","type":"profile.resolved","payload":{"profile":{"selected":"fast","source":"config","hash":"sha256:..."}},...}
  ```
