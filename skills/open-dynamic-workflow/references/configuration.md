# Open Dynamic Workflow Configuration Reference

This reference details Open Dynamic Workflow's configuration system, detailing the loading sequence, precedence hierarchy, validation rules, and built-in defaults.

---

## 1. Config Loading & Resolution

When Open Dynamic Workflow initializes, it resolves config values through a three-stage pipeline:

```mermaid
graph TD
    A[Built-in Defaults] --> B(Merge File Configuration)
    B --> C(Merge CLI Overrides)
    C --> D[Validate Config Schema]
    D --> E[Resolved Config Object]
```

### Loading Sequence
1.  **Read CLI Path**: If `-c` or `--config <path>` is specified, the CLI attempts to read that configuration file. If the file cannot be read or contains invalid YAML, a `CONFIG_VALIDATION_ERROR` is thrown.
2.  **Default Location fallback**: If no CLI config flag is provided, the CLI looks for `.open-dynamic-workflow/config.yaml` in the active project directory. If it is missing, the loading continues using only built-in defaults.
3.  **Merge CLI Options**: Overrides are applied from the command line (e.g. `--concurrency`, `--timeout-ms`, `--report`).
4.  **Schema Validation**: The merged configuration object is validated. Any discrepancy raises an exit code 3 (`Workflow parse or validation error`).

> [!NOTE]
> When the default project configuration file (`.open-dynamic-workflow/config.yaml`) is missing, the CLI automatically falls back to built-in defaults and continues execution. However, if a setup-time failure (such as missing directories, missing shared agents, or unresolved child workflows) occurs in this uninitialized state, the CLI will attach an informational initialization hint to guide the user toward running the `init` command.

### Generating Configuration with `open-dynamic-workflow init`

The `open-dynamic-workflow init` command generates a starter `.open-dynamic-workflow/config.yaml` with safe defaults and detected providers.

The generated config typically includes:
- `defaultProvider`: Set to the provider selected during initialization (e.g., `mock` or `codex`).
- `concurrency`, `timeoutMs`, `failFast`: Standard performance and error-handling defaults.
- `providers`:
  - `mock`: Always included as a safe, built-in fallback.
  - Selected External Provider: Included if an external provider (like `codex` or `gemini`) was chosen during `init`.
- `security`: Explicitly disables dangerous imports and sets up environment variable redaction.
- `sharedAgents.dir` and `tools.dir`: Configured to match the directories created by `init`.
- `workflow.discovery.include`: Automatically set to scan the workflows directory for runnable files.

Generated configuration is guaranteed to pass schema validation.

---

## 2. Configuration Options & Schema Validation

### Global Settings

| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `defaultProvider` | `string` | `"mock"` | Must be a key defined in `providers`. | Fallback provider used for agent calls if unspecified. |
| `concurrency` | `integer` | `4` | Positive integer (>= 1). | Maximum parallel tasks executed concurrently by the scheduler. |
| `timeoutMs` | `integer` | `900_000` | Positive integer (>= 1) in ms. | Global timeout for workflow execution. |
| `maxAgentCalls` | `integer` | unset | Positive integer (>= 1). | Maximum live provider agent calls a run may start. Resume cache hits do not count as new live calls. |
| `defaultModel` | `string \| null` | `null` | String, null, or undefined. | Global model override fallback for provider execution. |
| `workflow.maxDepth` | `integer` | `8` | Positive integer (>= 1). | Maximum recursion/invocation depth for nested workflows. |
| `workflow.maxLoopRounds` | `integer` | `20` | Positive integer (>= 1). | Global ceiling for `loop()` `maxRounds`; static and runtime validation reject loop options above this value. |
| `failFast` | `boolean` | `false` | Boolean. | If true, aborts execution immediately on the first task failure. |

---

### `workflow` Settings

| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `discovery.include` | `string[]` | `[]` | Array of non-empty strings. | Glob patterns for workflow discovery. Used by `list workflows` and for name-based `run`/`validate` lookup. |
| `maxDepth` | `integer` | `8` | Positive integer (>= 1). | Maximum recursion/invocation depth for nested workflows. |
| `maxLoopRounds` | `integer` | `20` | Positive integer (>= 1). | Maximum allowed `maxRounds` value for `loop()` calls. |

---

### `providers` Settings

A dictionary mapping provider names to provider config objects.

| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `command` | `string` | *(Required)* | Non-empty string. | Executable binary run in a subprocess (e.g., `codex`, `gemini`). |
| `args` | `string[]` | `[]` | Array of strings. | Command-line arguments prepended before agent arguments. |
| `defaultModel` | `string \| null` | `null` | String, null, or undefined. | Fallback model override for this provider. |
| `modelArg` | `object \| false`| `undefined` | Must be `false` or object containing `{ flag: string }`. | Dictates how the model option is passed to the provider binary. |
| `promptMode` | `string` | `undefined` | Must be `"stdin"` or `"arg"`. | `"stdin"` writes prompts to the process stdin. `"arg"` appends it as a final command line argument. |
| `defaultThinkingEffort` | `string` | `undefined` | `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`. | Default thinking effort level for this provider if not overridden by the script or CLI option. There is no global default. |

#### Built-in Provider Defaults

```yaml
providers:
  mock:
    command: "mock"
    args: []
    defaultModel: null
    responses:
      default:
        text: "mock response"
  codex:
    command: "codex"
    args:
      - "exec"
      - "--json"
      - "--ephemeral"
    defaultModel: null
  gemini:
    command: "gemini"
    args:
      - "--output-format"
      - "json"
      - "--approval-mode"
      - "plan"
    defaultModel: "gemini-3-flash-preview"
    promptMode: "stdin"
  copilot:
    # Targets the standalone 'copilot' binary, NOT 'gh copilot'.
    # Authentication must be handled via 'copilot auth login'.
    command: "copilot"
    args:
      - "-s"
      - "--no-ask-user"
      - "--no-auto-update"
      - "--output-format=json"
    defaultModel: null
    modelArg: { flag: "--model" }
    promptMode: "arg"
    promptFlag: "-p"
    dangerouslySkipPermissionsFlag: "--yolo"
    permissionPolicy: "restricted"
  opencode:
    command: "opencode"
    args: ["run", "--format", "json"]
    defaultModel: null
    modelArg: { flag: "--model" }
    promptMode: "arg"
    permissionPolicy: "read-only"
  antigravity:
    command: "agy"
    args: []
    defaultModel: null
    modelArg: { flag: "--model" }
    promptMode: "arg"
    promptFlag: "-p"
    sandboxFlag: "--sandbox"
    dangerouslySkipPermissionsFlag: "--dangerously-skip-permissions"
    useSandboxByDefault: true
    permissionPolicy: "sandbox"
  pi:
    command: "pi"
    executionMode: "json"
    defaultModel: null
    modelArg: { flag: "--model" }
    promptMode: "arg"
    safeTools: ["read", "grep", "find", "ls"]
    fullAccessTools: ["read", "bash", "edit", "write", "grep", "find", "ls"]
    noSession: true
    noContextFiles: true
    noExtensions: true
    noSkills: true
    noPromptTemplates: true
    noThemes: true
    approvalMode: "no-approve"
    deterministicEnv: true
  cursor:
    command: "agent"
    args: []
    promptMode: "arg"
    promptFlag: "-p"
    outputFormat: "json"
    outputFormatFlag: "--output-format"
    trustFlag: "--trust"
    modeFlag: "--mode"
    defaultMode: "ask"
    modelArg: { flag: "--model" }
    workspaceFlag: false
    dangerouslySkipPermissionsFlag: "--force"
```

### Thinking Effort Configuration

You can configure a default thinking effort level per provider using the `defaultThinkingEffort` configuration option. This is an execution preference and does not guarantee identical reasoning depth across different providers. Note that there is no global `defaultThinkingEffort` option; it must be configured per provider.

Example config snippet:
```yaml
providers:
  codex:
    command: "codex"
    defaultThinkingEffort: low
  pi:
    command: "pi"
    defaultThinkingEffort: medium
  opencode:
    command: "opencode"
    defaultThinkingEffort: high
```

#### Provider Legacy & Compatibility Behaviors:
- **Pi Legacy `thinking` Option**: Pi supports a legacy, provider-specific `thinking` setting in the provider config (which maps to Pi's specific `--thinking` flag). If `defaultThinkingEffort` is not specified and no thinking effort is resolved from the agent script or CLI, the legacy `thinking` option is used as a fallback.
- **OpenCode Variant Override**: OpenCode supports a `defaultVariant` option. If a first-class `defaultThinkingEffort` is resolved, it overrides the `defaultVariant`. However, specifying an explicit `opencodeVariant` in agent metadata while also resolving a thinking effort results in a validation conflict.

#### Adapter-specific provider keys

The following keys are supported by specific provider adapters.

*   **Compatibility**: Unknown provider extension keys remain allowed for compatibility with future provider versions.
*   **Validation**: Known provider-specific fields are strictly validated when present. Invalid enum-like values, non-boolean resource flags, empty string flags, and invalid tool arrays will fail configuration validation.

**OpenCode (opencode)**
| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `permissionPolicy` | `string` | `"read-only"` | `"read-only"` or `"passthrough"`. | Default `"read-only"` injects OpenCode permission config; `"passthrough"` skips it. |
| `defaultAgent` | `string` | `undefined` | Non-empty string. | Default agent name if not specified by metadata. |
| `defaultVariant` | `string` | `undefined` | Non-empty string. | Default agent variant if not specified by metadata. |
| `dirFlag` | `string \| false` | `undefined` | Non-empty string or `false`. | Flag used to specify the directory to OpenCode. |
| `agentFlag` | `string` | `undefined` | Non-empty string. | Flag used to specify the agent name. |
| `variantFlag` | `string` | `undefined` | Non-empty string. | Flag used to specify the agent variant. |
| `formatFlag` | `string` | `undefined` | Non-empty string. | Flag used to specify the output format. |
| `format` | `string` | `undefined` | Non-empty string. | Output format value (e.g., `"json"`). |
| `dangerouslySkipPermissionsFlag` | `string` | `undefined` | Non-empty string. | Flag to skip OpenCode-side permission checks. |

**GitHub Copilot (copilot)**
| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `permissionPolicy` | `string` | `"restricted"` | `"restricted"` or `"passthrough"`. | Default `"restricted"` does not add broad allow-all or yolo flags; `"passthrough"` skips it. |
| `promptFlag` | `string` | `"-p"` | Non-empty string. | Flag used to pass the prompt. |
| `dangerouslySkipPermissionsFlag` | `string` | `"--yolo"` | Non-empty string. | Flag to skip permission checks. |

**Antigravity (antigravity)**
| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `permissionPolicy` | `string` | `"sandbox"` | `"sandbox"` or `"native"`. | Dictates whether execution uses a sandbox or native environment. Execution MUST use one of these policies. |
| `useSandboxByDefault` | `boolean` | `true` | Boolean. | Whether to default to sandbox mode. |
| `promptFlag` | `string` | `"-p"` | Non-empty string. | Flag used to pass the prompt. |
| `sandboxFlag` | `string` | `"--sandbox"` | Non-empty string. | Flag used to enable the sandbox. |
| `dangerouslySkipPermissionsFlag` | `string` | `"--dangerously-skip-permissions"` | Non-empty string. | Flag to skip permission checks. |
| `printTimeoutFlag` | `string` | `undefined` | Non-empty string. | Flag used to specify the print timeout. |

*Note: Antigravity sandboxing provides environment isolation but is not a complete security sandbox.*

**Pi (pi)**
| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `executionMode` | `string` | `"json"` | `"json"` or `"print"`. | `"json"` uses event-stream mode; `"print"` uses standard output mode. |
| `approvalMode` | `string` | `"no-approve"` | `"approve"`, `"no-approve"`, or `"omit"`. | Controls whether `--approve` or `--no-approve` is passed. |
| `safeTools` | `string[]` | `["read", ...]` | Array of non-empty strings. | Tools allowed in default permission mode. |
| `fullAccessTools` | `string[]` | `["read", ...]` | Array of non-empty strings. | Tools allowed in `dangerously-full-access` mode. |
| `deterministicEnv` | `boolean` | `true` | Boolean. | If true, sets `PI_SKIP_VERSION_CHECK=1` and `PI_TELEMETRY=0`. |
| `piProvider` | `string` | `undefined` | Non-empty string. | Value passed to the `--provider` flag. |
| `providerFlag` | `string` | `"--provider"` | Non-empty string. | Flag used to specify the Pi provider. |
| `thinking` | `string` | `undefined` | Non-empty string. | Value passed to the `--thinking` flag. |
| `systemPrompt` | `string` | `undefined` | Non-empty string. | Value passed to the `--system-prompt` flag. |
| `appendSystemPrompt` | `string` | `undefined` | Non-empty string. | Value passed to the `--append-system-prompt` flag. |
| `noSession` | `boolean` | `true` | Boolean. | If true, passes `--no-session`. |
| `noContextFiles` | `boolean` | `true` | Boolean. | If true, passes `--no-context-files`. |
| `noExtensions` | `boolean` | `true` | Boolean. | If true, passes `--no-extensions`. |
| `noSkills` | `boolean` | `true` | Boolean. | If true, passes `--no-skills`. |
| `noPromptTemplates` | `boolean` | `true` | Boolean. | If true, passes `--no-prompt-templates`. |
| `noThemes` | `boolean` | `true` | Boolean. | If true, passes `--no-themes`. |

*Note: Switching to `dangerously-full-access` mode changes the active tool list to `fullAccessTools` but does NOT imply `--approve`. Approval must be configured separately via `approvalMode`.*

**Cursor (cursor)**
| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `promptMode` | `string` | `"arg"` | `"arg"` or `"stdin"`. | Specifies how the prompt is passed to the Cursor Agent CLI. |
| `promptFlag` | `string` | `"-p"` | Non-empty string. | Flag used to specify the prompt. |
| `outputFormat` | `string` | `"json"` | `"text"`, `"json"`, or `"stream-json"`. | The expected output format from the Cursor Agent CLI. |
| `outputFormatFlag` | `string` | `"--output-format"` | Non-empty string. | Flag used to specify the output format. |
| `trustFlag` | `string \| false` | `"--trust"` | Non-empty string or `false`. | Flag used to establish workspace trust. Set to `false` to disable. |
| `modeFlag` | `string` | `"--mode"` | Non-empty string. | Flag used to specify execution mode. |
| `defaultMode` | `string` | `"ask"` | Non-empty string. | Default mode (e.g., `"ask"`, `"plan"`). |
| `dangerouslySkipPermissionsFlag` | `string` | `"--force"` | Non-empty string. | Flag used to skip interactive permission/confirmation prompts. |
| `workspaceFlag` | `string \| false` | `false` | Non-empty string or `false`. | Flag used to pass the workspace path. |

---

### `security` Settings

Enforces sandbox constraints for workflow execution.

| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `allowWorkflowImports` | `boolean` | `false` | Must be strictly `false` in MVP. | Blocks workflows from importing arbitrary packages. |
| `passEnv` | `string[]` | `[]` | Array of strings. | Allowlist of environment variables propagated to provider processes. |
| `redactEnv` | `string[]` | *(See below)* | Array of strings. | List of environment variable values redacted from outputs and logs. |

#### Default Redaction List
To prevent accidental credentials leakage, the following environment variables (and matching wildcard pattern values) are redacted:
*   `OPENAI_API_KEY`
*   `GEMINI_API_KEY`
*   `GOOGLE_API_KEY`
*   `*_KEY`
*   `*_TOKEN`
*   `*_SECRET`
*   `PASSWORD`

---

### `reporting` Settings

Controls visual outputs and terminal formatting.

| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `mode` | `string` | `"pretty"` | Must be `"pretty"`, `"json"`, or `"jsonl"`. | Layout format printed to stdout (terminal visualization vs structured logs). |
| `verbose` | `boolean` | `false` | Boolean. | Enables debugging messages. |

---

## 3. Override Resolution Precedence

When evaluating configuration keys (like `model` or `timeoutMs`), the runtime resolves properties using the following hierarchy (highest precedence first):

1.  **Agent DSL Parameter**: Options explicitly supplied inside the script code (e.g. `agent({ model: "custom" })`).
2.  **CLI Flag Overrides**: Arguments provided directly on shell execution (e.g. `open-dynamic-workflow run --model overridden-model`).
3.  **YAML File Configuration**: Properties declared in `.open-dynamic-workflow/config.yaml`.
4.  **Built-in Defaults**: Fallback values defined in Open Dynamic Workflow's core engine defaults.

---

## 4. Shared Agents Configuration (`sharedAgents`)

Shared agent settings dictate how reusable, code-based agent definitions are loaded and validated:
*   `sharedAgents`:
    *   `dir`: Directory path scanned for shared agent definitions (defaults to `".open-dynamic-workflow/agents"`).
    *   `maxDefinitions`: Positive integer limit on the maximum definitions loaded (defaults to 100).
    *   `allowDynamicIds`: Must be strictly `false` (dynamic shared agent IDs are rejected for security reasons).
    *   `strictPromptTemplateVariables`: Boolean specifying if template variables must match declared schema properties.

---

## 5. Tools Configuration (`tools`)

Tools settings dictate how reusable, trusted application extensions declared with `defineTool()` are loaded, validated, and executed:

| Option | Type | Default | Validation Rules | Description |
| :--- | :--- | :--- | :--- | :--- |
| `dir` | `string` | `".open-dynamic-workflow/tools"` | Non-empty path string. | Directory path scanned for tool definitions. |
| `concurrency` | `integer` | `4` | Positive integer (>= 1). | Maximum parallel tool calls executed concurrently by the tool execution lane. |
| `maxDefinitions` | `integer` | `100` | Positive integer (>= 1). | Limit on the maximum tool definitions loaded. |

Example config snippet:
```yaml
tools:
  dir: ".open-dynamic-workflow/tools"
  concurrency: 4
  maxDefinitions: 100
```
