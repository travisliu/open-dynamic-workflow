# OpenFlow CLI Commands

This document summarizes the command-line interface (CLI) commands and options for OpenFlow.

---

## Initialize a project

Initializes a project for OpenFlow by creating a recommended starter layout and configuration.

```bash
openflow init [options]
```

### Generated Structure

By default, `openflow init` creates:

```text
.openflow/
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
openflow init
openflow init --yes
openflow init --yes --run-smoke-test
openflow init --strict
openflow init --force --provider codex
```

### Behavior

* **Interactive mode**: Default when stdin is a TTY. Prompts for provider selection and confirmation.
* **Non-interactive mode**: Triggered by `--yes` or non-TTY stdin. Uses defaults or requested options.
* **Mock fallback**: If a requested provider is not found in `PATH`, `init` offers a fallback to the `mock` provider.
* **Safety**: Does **not** modify `package.json`. Existing files are skipped unless `--force` is used.
* **Smoke test**: If `--run-smoke-test` is used, OpenFlow performs a `validate` and `run --provider mock` on the generated example workflow.

---

## Run a workflow

Runs a workflow by name or file path.

```bash
openflow run <workflow-name-or-file>
```

### Resolution Rules

* **Path-like targets**: Targets containing `/`, starting with `./` or `../`, absolute paths, or ending with workflow extensions (`.ts`, `.js`, etc.) are resolved as file paths directly.
* **Bare targets**: Targets without path separators or extensions are resolved by exact `meta.name` first. If no name matches, OpenFlow falls back to resolving the target as a file path relative to the `cwd`.
* **Duplicate names**: If multiple workflows in the discovery scope share the same `meta.name`, the command will fail with a listing of matching files.

Use `openflow list workflows` to see runnable names and their resolved paths.

### Common options
...
### Examples

```bash
openflow run review
openflow run workflows/review.ts
openflow run review --provider codex
openflow run review --provider mock
openflow run review --concurrency 2
openflow run review --timeout-ms 600000
openflow run review --report json
openflow run review --report jsonl
openflow run review --fail-fast
openflow run review --resume <previous-run-id>
```

---

## Resume a previous run

Runs a new workflow attempt from a previous run's recorded invocation and reuses cached agent results for the longest unchanged prefix.

```bash
openflow resume <runId-or-path> [options]
```

### Common options
...
### Example

```bash
openflow resume <previous-run-id>
```

### Behavior

Resume/cache is intentionally conservative. OpenFlow replays the workflow script and compares each `agent()` call in order. A cached result is reused only while the prefix is unchanged: the call sequence must match, `id` or `label` must match when present, and the call fingerprint must match.

`openflow resume` reuses the exact `workflowFile` recorded in the original run's `run-input.json`, even if the original run was started by name. This ensures deterministic replay even if name resolution would now point to a different file.

Use stable `id` values for loops, such as `id: \`round-${i}\``. Using `Date.now()`, `Math.random()`, and argument-free `new Date()` will trigger validation warnings (e.g., `Avoid Date.now(): it prevents deterministic resume/cache behavior. Use tool() instead.`) because they prevent deterministic replay. If you need non-deterministic values like timestamps or random numbers, wrap them in a custom `tool()` call so they are cached on the first run and replayed deterministically on subsequent runs.

---

## Validate a workflow

Validates a workflow by name or file path.

```bash
openflow validate <workflow-name-or-file>
```

### Example

```bash
openflow validate review
openflow validate workflows/review.ts
```

### Validation checks include

* `meta` is the first top-level statement.
* `meta.name` and `meta.description` are present.
* Metadata is statically analyzable.
* Unsupported imports and restricted APIs are rejected.
* Supported `pipeline()` usage is accepted.
* Obviously invalid `pipeline()` usage is rejected.
* Shared agent definitions in `sharedAgents.dir` are loaded and validated.
* Verifies that `agent({ definition })` and `ctx.agent({ definition })` calls use string literal IDs that exist in the shared agent registry (when `sharedAgents.allowDynamicIds` is false).
* Tool definitions in `tools.dir` are loaded and validated.
* Verifies that `tool({ definition })` calls use string literal IDs that exist in the tool registry.

---

## Check environment readiness

```bash
openflow doctor
```

### Checks include

* config file can be loaded.
* provider CLIs are present.
* `openflow doctor` reports all built-in provider adapters.
* Missing optional provider CLIs (like `copilot`, `opencode`, `agy`, or `pi`) are shown as unavailable but do not cause the doctor command to fail unless they are the configured `defaultProvider`.
* Note: For `copilot`, the doctor command checks for the standalone `copilot` executable but does not perform authentication or login checks.
* provider commands can be executed.
* `secret-like environment values` are not printed.

---

## List resources

```bash
openflow list [resourceType]
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
openflow list
openflow list workflows
openflow list agents --verbose
openflow list tools --report json
openflow list --strict
openflow list workflows --dir examples/workflows
```

### Resource Discovery

* **Workflows**: Scanned from the directory configured in `workflows.dir` (defaults to `workflows`).
* **Agents**: Scanned from the directory configured in `sharedAgents.dir` (defaults to `.openflow/agents`).
* **Tools**: Scanned from the directory configured in `tools.dir` (defaults to `.openflow/tools`).

The `list` command is lenient by default. It will report errors and warnings but exit with code `0` unless `--strict` is used. In strict mode, any discovery error (e.g., duplicate IDs, invalid definitions) results in a non-zero exit code (3).

---

## Shared Agent Loading & Security Policy

When executing `openflow run` or `openflow validate`, OpenFlow scans the configured `sharedAgents.dir` directory.
If a file contains unauthorized symbols or attempts host operations violating the validation restrictions, a `SHARED_AGENT_SECURITY_POLICY_VIOLATION` error is thrown, halting execution or validation immediately.
Literal shared agent IDs referenced in `agent({ definition })` or `ctx.agent({ definition })` are checked against this loaded registry.

---

## Tool Loading & Trust Model

When executing `openflow run` or `openflow validate`, OpenFlow scans the configured `tools.dir` directory (defaults to `.openflow/tools`).
Unlike workflows or shared agents, tool definitions are trusted application extensions. They may execute unrestricted JavaScript with host access (e.g., read/write files, execute shell commands, import packages, or perform network requests).
However, tool definitions must be declared with `defineTool()` and have valid default exports. Duplicate or invalid tool definitions will cause a `TOOL_INVALID_DEFINITION` or `TOOL_DUPLICATE_DEFINITION` validation error.
Individual `tool({ definition })` calls are checked statically during validation to ensure they reference a registered tool ID.

