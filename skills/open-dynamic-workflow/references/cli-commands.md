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
  agents/           # Shared agents directory (empty)
  tools/            # Tools directory (empty)
workflows/
  example.ts        # Starter workflow template
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
* **Smoke test**: If `--run-smoke-test` is used, Open Dynamic Workflow performs a `validate` and `run --provider mock` on the generated example workflow.

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
| `--provider <name>` | Override the default provider. |
| `--model <name>` | Override the default model. |
| `--concurrency <num>` | Limit maximum parallel agent calls (integer >= 1). |
| `--timeout-ms <num>` | Timeout in milliseconds for workflow execution. |
| `--max-agent-calls <num>` | Limit the maximum number of live provider calls allowed. |
| `--report <pretty\|json\|jsonl>` | Output formatting mode for stdout. |
| `--fail-fast` | Abort immediately on the first agent/task failure. |
| `--resume <run-id>` | Resume a previous run using cache replay. |
| `--config <path>` | Path to the YAML configuration file. |
| `--cwd <path>` | Current working directory to resolve workflows and configurations. |
| `--out <path>` | Output directory for artifacts and reports. |
| `--thinking-effort <effort>` | Override the thinking effort level for all eligible agent calls. Must be one of: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. This is an execution preference and does not guarantee identical reasoning depth across different providers. Per-agent `thinkingEffort` values defined in the workflow script override this CLI value. If this resolves to a value unsupported by the selected provider, execution will fail. |

### Examples

```bash
open-dynamic-workflow run review
open-dynamic-workflow run workflows/review.ts
open-dynamic-workflow run review --provider codex
open-dynamic-workflow run review --provider mock
open-dynamic-workflow run review --concurrency 2
open-dynamic-workflow run review --timeout-ms 600000
open-dynamic-workflow run review --max-agent-calls 20
open-dynamic-workflow run review --report json
open-dynamic-workflow run review --report jsonl
open-dynamic-workflow run review --fail-fast
open-dynamic-workflow run review --resume <previous-run-id>
open-dynamic-workflow run review --thinking-effort high
```

---

## Resume a previous run

Runs a new workflow attempt from a previous run's recorded invocation and reuses cached agent results for the longest unchanged prefix.

```bash
open-dynamic-workflow resume <runId-or-path> [options]
```

### Common options
...
### Example

```bash
open-dynamic-workflow resume <previous-run-id>
```

### Behavior

Resume/cache is intentionally conservative. Open Dynamic Workflow replays the workflow script and compares each `agent()` call in order. A cached result is reused only while the prefix is unchanged: the call sequence must match, `id` or `label` must match when present, and the call fingerprint must match.

`open-dynamic-workflow resume` reuses the exact `workflowFile` recorded in the original run's `run-input.json`, even if the original run was started by name. This ensures deterministic replay even if name resolution would now point to a different file.

Use stable `id` values for loops, such as `id: \`round-${i}\``. Using `Date.now()`, `Math.random()`, and argument-free `new Date()` will trigger validation warnings (e.g., `Avoid Date.now(): it prevents deterministic resume/cache behavior. Use tool() instead.`) because they prevent deterministic replay. If you need non-deterministic values like timestamps or random numbers, wrap them in a custom `tool()` call so they are cached on the first run and replayed deterministically on subsequent runs.

---

## Validate a workflow

Validates a workflow by name or file path.

```bash
open-dynamic-workflow validate <workflow-name-or-file>
```

### Example

```bash
open-dynamic-workflow validate review
open-dynamic-workflow validate workflows/review.ts
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
* Shared agent definitions in `sharedAgents.dir` are loaded and validated.
* Verifies that `agent({ definition })` and `ctx.agent({ definition })` calls use string literal IDs that exist in the shared agent registry (when `sharedAgents.allowDynamicIds` is false).
* Tool definitions in `tools.dir` are loaded and validated.
* Verifies that `tool({ definition })` calls use string literal IDs that exist in the tool registry.

---

## Check environment readiness

```bash
open-dynamic-workflow doctor
```

### Checks include

* config file can be loaded.
* provider CLIs are present.
* `open-dynamic-workflow doctor` reports all built-in provider adapters.
* Missing optional provider CLIs (like `copilot`, `opencode`, `agy`, or `pi`) are shown as unavailable but do not cause the doctor command to fail unless they are the configured `defaultProvider`.
* Note: For `copilot`, the doctor command checks for the standalone `copilot` executable but does not perform authentication or login checks.
* provider commands can be executed.
* `secret-like environment values` are not printed.

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

* **Workflows**: Scanned from the directory configured in `workflows.dir` (defaults to `workflows`).
* **Agents**: Scanned from the directory configured in `sharedAgents.dir` (defaults to `.open-dynamic-workflow/agents`).
* **Tools**: Scanned from the directory configured in `tools.dir` (defaults to `.open-dynamic-workflow/tools`).

The `list` command is lenient by default. It will report errors and warnings but exit with code `0` unless `--strict` is used. In strict mode, any discovery error (e.g., duplicate IDs, invalid definitions) results in a non-zero exit code (3).

---

## Shared Agent Loading & Security Policy

When executing `open-dynamic-workflow run` or `open-dynamic-workflow validate`, Open Dynamic Workflow scans the configured `sharedAgents.dir` directory.
If a file contains unauthorized symbols or attempts host operations violating the validation restrictions, a `SHARED_AGENT_SECURITY_POLICY_VIOLATION` error is thrown, halting execution or validation immediately.
Literal shared agent IDs referenced in `agent({ definition })` or `ctx.agent({ definition })` are checked against this loaded registry.

---

## Tool Loading & Trust Model

When executing `open-dynamic-workflow run` or `open-dynamic-workflow validate`, Open Dynamic Workflow scans the configured `tools.dir` directory (defaults to `.open-dynamic-workflow/tools`).
Unlike workflows or shared agents, tool definitions are trusted application extensions. They may execute unrestricted JavaScript with host access (e.g., read/write files, execute shell commands, import packages, or perform network requests).
However, tool definitions must be declared with `defineTool()` and have valid default exports. Duplicate or invalid tool definitions will cause a `TOOL_INVALID_DEFINITION` or `TOOL_DUPLICATE_DEFINITION` validation error.
Individual `tool({ definition })` calls are checked statically during validation to ensure they reference a registered tool ID.

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

