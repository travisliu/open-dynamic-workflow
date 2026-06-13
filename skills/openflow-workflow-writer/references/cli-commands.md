# OpenFlow CLI Commands

This document summarizes the command-line interface (CLI) commands and options for OpenFlow.

---

## Run a workflow

```bash
openflow run <workflow-file>
```

### Common options

```bash
--provider <codex|gemini|mock>
--arg key=value
--config <path>
--cwd <path>
--out <path>
--report <pretty|json|jsonl>
--concurrency <number>
--timeout-ms <number>
--dry-run
--fail-fast
--verbose
```

### Examples

```bash
openflow run workflows/review.ts
openflow run workflows/review.ts --provider codex
openflow run workflows/review.ts --provider mock
openflow run workflows/review.ts --concurrency 2
openflow run workflows/review.ts --timeout-ms 600000
openflow run workflows/review.ts --report json
openflow run workflows/review.ts --report jsonl
openflow run workflows/review.ts --fail-fast
```

---

## Validate a workflow

```bash
openflow validate <workflow-file>
```

### Example

```bash
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
* Missing optional provider CLIs (like `opencode`, `agy`, or `pi`) are shown as unavailable but do not cause the doctor command to fail unless they are the configured `defaultProvider`.
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

