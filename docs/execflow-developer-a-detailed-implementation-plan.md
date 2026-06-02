# execflow MVP — Developer A Detailed Implementation Plan

**Developer lane:** Developer A  
**Ownership:** CLI, configuration, workflow loading, workflow parsing, workflow validation, error and exit-code mapping  
**Audience:** Junior engineers implementing the MVP  
**Date:** 2026-06-02  
**Source inputs:** execflow PRD, Architecture Design, MVP Technical Design, four-developer implementation plan

---

## 1. Goal

Developer A is responsible for making execflow usable from the command line and making workflow files safe enough to hand to the runtime.

By the end of this lane, a user should be able to run:

```bash
execflow validate examples/parallel-review.js
execflow run examples/parallel-review.js --provider mock --report pretty
execflow run examples/parallel-review.js --provider mock --report json
execflow doctor
```

Developer A does **not** implement provider execution, scheduling, artifacts, reporters, or runtime internals. Those are owned by Developers B, C, and D. Developer A should define clean handoff points so those parts can be plugged in.

---

## 2. MVP Scope for Developer A

### 2.1 In scope

Developer A implements:

- CLI entrypoint and command routing.
- `execflow run <workflow-file>` command shell.
- `execflow validate <workflow-file>`.
- `execflow doctor` command shell.
- CLI option parsing and validation.
- Config loading from `.execflow/config.yaml` or `--config`.
- Config defaults and precedence rules.
- Workflow source loading.
- Static metadata extraction.
- Workflow validation restrictions.
- Standard error types.
- Exit-code mapping.
- Unit tests for CLI, config, parser, and validator.

### 2.2 Out of scope

Developer A must **not** implement these in MVP:

- `pipeline()`.
- Retry policy.
- Worktree isolation.
- Container isolation.
- Provider plugins.
- Resumable runs.
- Approval gates.
- Automatic patch application.
- Provider-level concurrency limits.
- Real process spawning for Codex or Gemini.
- JSON Schema validation.
- Pretty, JSON, or JSONL reporter rendering.
- Artifact writing beyond passing data to Developer D interfaces.

---

## 3. Collaboration Contracts

Developer A should create or consume these contracts so other developers can work independently.

### 3.1 Runtime handoff contract

Developer A should not call runtime internals directly. The `run` command should call a small interface that Developer B can implement.

```ts
export interface RuntimeRunner {
  run(input: RuntimeRunInput): Promise<WorkflowRunResult>;
}

export interface RuntimeRunInput {
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedExecflowConfig;
  cli: RunCliOptions;
}
```

During early development, Developer A can use a stub implementation that returns a synthetic successful result.

### 3.2 Doctor handoff contract

Developer A owns the command shape. Developer C owns provider health checks.

```ts
export interface ProviderHealthChecker {
  checkAll(config: ResolvedExecflowConfig): Promise<DoctorResult>;
}
```

### 3.3 Artifact/reporting handoff contract

Developer A should not write full run artifacts. Developer A should pass resolved inputs to runtime. Developer D owns artifact store and reporters.

For `run --dry-run`, Developer A may print a simple static summary directly because no runtime execution occurs.

---

## 4. Implementation Order

Follow this order to avoid blocking other developers.

1. Create shared error and type files.
2. Implement CLI entrypoint and command routing.
3. Implement option parsing and option validation.
4. Implement config defaults and config loader.
5. Implement workflow source loader.
6. Implement metadata parser.
7. Implement workflow validator.
8. Implement `validate` command end to end.
9. Implement `run --dry-run` end to end.
10. Implement `run` handoff to runtime interface.
11. Implement `doctor` command shell.
12. Add unit tests and fixtures.
13. Integrate with Developer B/C/D implementations.

---

## 5. Files to Create or Edit

The paths below assume the repository follows the planned TypeScript structure.

```text
execflow/
  package.json
  tsconfig.json
  src/
    index.ts
    cli/
      index.ts
      args.ts
      print.ts
      commands/
        run.ts
        validate.ts
        doctor.ts
    config/
      defaults.ts
      load.ts
      merge.ts
      schema.ts
      types.ts
    workflow/
      load.ts
      parse.ts
      validate.ts
      types.ts
    errors/
      codes.ts
      types.ts
      serialize.ts
      exit-codes.ts
    runtime/
      public.ts
    doctors/
      public.ts
  tests/
    unit/
      cli/
        args.test.ts
        run-command.test.ts
        validate-command.test.ts
      config/
        load-config.test.ts
        merge-config.test.ts
      workflow/
        load-workflow.test.ts
        parse-metadata.test.ts
        validate-workflow.test.ts
      errors/
        exit-codes.test.ts
    fixtures/
      workflows/
        valid-simple.js
        valid-with-phases.js
        invalid-missing-meta.js
        invalid-meta-not-first.js
        invalid-dynamic-meta.js
        invalid-require.js
        invalid-import.js
        invalid-process.js
        invalid-fs.js
        invalid-pipeline.js
      config/
        valid-config.yaml
        invalid-provider.yaml
        invalid-concurrency.yaml
        invalid-report-mode.yaml
  examples/
    parallel-review.js
```

---

## 6. Detailed File Plan

## 6.1 `package.json`

**Action:** Edit or create.  
**Purpose:** Define the executable binary, scripts, and dependencies.

### Required details

Add a `bin` entry:

```json
{
  "bin": {
    "execflow": "dist/index.js"
  }
}
```

Recommended scripts:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:types": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint ."
  }
}
```

Recommended dependencies:

```json
{
  "dependencies": {
    "commander": "latest",
    "yaml": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "vitest": "latest",
    "@types/node": "latest"
  }
}
```

`commander` is suggested for CLI parsing. `yaml` is suggested for `.execflow/config.yaml` parsing. If the team already chose different libraries, use the team standard.

### Acceptance criteria

- `pnpm build` succeeds.
- Running the built binary prints help.
- Unknown commands return exit code `2`.

---

## 6.2 `tsconfig.json`

**Action:** Edit or create.  
**Purpose:** TypeScript compiler configuration.

### Required details

Use strict mode.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

### Junior engineer notes

- Do not disable `strict` to make errors disappear.
- Prefer fixing types at the boundary where data enters the system.
- Config files and CLI inputs are untrusted; validate them before casting.

---

## 6.3 `src/index.ts`

**Action:** Create.  
**Purpose:** Executable entrypoint.

### Required details

This file should be very small. It should call the CLI runner and translate errors into exit codes.

```ts
#!/usr/bin/env node

import { main } from "./cli/index.js";
import { exitCodeForError } from "./errors/exit-codes.js";
import { serializeError } from "./errors/serialize.js";

main(process.argv).catch((error) => {
  const serialized = serializeError(error);
  console.error(serialized.message);
  process.exitCode = exitCodeForError(error);
});
```

### Acceptance criteria

- Does not contain command-specific logic.
- Does not parse workflow files.
- Does not call provider code directly.

---

## 6.4 `src/errors/codes.ts`

**Action:** Create.  
**Purpose:** Central list of application error codes.

### Required details

```ts
export const ErrorCode = {
  CLI_USAGE_ERROR: "CLI_USAGE_ERROR",
  CONFIG_VALIDATION_ERROR: "CONFIG_VALIDATION_ERROR",
  WORKFLOW_PARSE_ERROR: "WORKFLOW_PARSE_ERROR",
  WORKFLOW_VALIDATION_ERROR: "WORKFLOW_VALIDATION_ERROR",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_PROCESS_FAILED: "PROVIDER_PROCESS_FAILED",
  PROCESS_TIMEOUT: "PROCESS_TIMEOUT",
  SCHEMA_VALIDATION_FAILED: "SCHEMA_VALIDATION_FAILED",
  SECURITY_POLICY_VIOLATION: "SECURITY_POLICY_VIOLATION",
  USER_CANCELLED: "USER_CANCELLED",
  ARTIFACT_WRITE_FAILED: "ARTIFACT_WRITE_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

### Junior engineer notes

- Use these constants instead of string literals spread across files.
- If a new error appears, add it here first and update the exit-code mapping.

---

## 6.5 `src/errors/types.ts`

**Action:** Create.  
**Purpose:** Standard error class and serialized error type.

### Required details

```ts
import type { ErrorCode } from "./codes.js";

export interface SerializedError {
  name: string;
  message: string;
  code?: ErrorCode;
  stack?: string;
  cause?: unknown;
}

export class ExecflowError extends Error {
  readonly code: ErrorCode;
  readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ExecflowError";
    this.code = code;
    this.cause = options?.cause;
  }
}
```

### Acceptance criteria

- All intentional failures use `ExecflowError`.
- Unexpected failures can still be plain `Error`, but they map to internal error.

---

## 6.6 `src/errors/serialize.ts`

**Action:** Create.  
**Purpose:** Convert unknown thrown values into safe reportable errors.

### Required details

```ts
import { ExecflowError, type SerializedError } from "./types.js";

export function serializeError(error: unknown): SerializedError {
  if (error instanceof ExecflowError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}
```

### Junior engineer notes

- Do not include environment variables or secrets in serialized errors.
- Do not stringify entire config objects inside error messages.

---

## 6.7 `src/errors/exit-codes.ts`

**Action:** Create.  
**Purpose:** Map known errors and final workflow status to process exit codes.

### Required details

```ts
import { ErrorCode } from "./codes.js";
import { ExecflowError } from "./types.js";

export const ExitCode = {
  Success: 0,
  WorkflowFailed: 1,
  CliUsage: 2,
  WorkflowInvalid: 3,
  ProviderUnavailable: 4,
  SecurityPolicyViolation: 5,
  UserCancelled: 6,
  Timeout: 7,
  InternalError: 8
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export function exitCodeForError(error: unknown): ExitCode {
  if (!(error instanceof ExecflowError)) return ExitCode.InternalError;

  switch (error.code) {
    case ErrorCode.CLI_USAGE_ERROR:
    case ErrorCode.CONFIG_VALIDATION_ERROR:
      return ExitCode.CliUsage;
    case ErrorCode.WORKFLOW_PARSE_ERROR:
    case ErrorCode.WORKFLOW_VALIDATION_ERROR:
      return ExitCode.WorkflowInvalid;
    case ErrorCode.PROVIDER_UNAVAILABLE:
      return ExitCode.ProviderUnavailable;
    case ErrorCode.SECURITY_POLICY_VIOLATION:
      return ExitCode.SecurityPolicyViolation;
    case ErrorCode.USER_CANCELLED:
      return ExitCode.UserCancelled;
    case ErrorCode.PROCESS_TIMEOUT:
      return ExitCode.Timeout;
    default:
      return ExitCode.InternalError;
  }
}
```

### Acceptance criteria

- Invalid CLI usage returns `2`.
- Workflow parse/validation error returns `3`.
- Provider unavailable returns `4`.
- Security policy error returns `5`.
- Timeout returns `7`.

---

## 6.8 `src/config/types.ts`

**Action:** Create.  
**Purpose:** Define raw and resolved config shapes.

### Required details

```ts
export type ProviderName = "codex" | "gemini" | "mock" | string;
export type ReporterMode = "pretty" | "json" | "jsonl";

export interface ProviderConfig {
  command: string;
  args: string[];
  defaultModel: string | null;
  timeoutMs?: number;
  env?: Record<string, string>;
  responses?: Record<string, unknown>; // Used by mock provider.
}

export interface SecurityConfig {
  passEnv: string[];
  redactEnv: string[];
  allowShell: false;
  allowWorkflowImports: false;
}

export interface ExecflowConfig {
  defaultProvider: ProviderName;
  concurrency: number;
  timeoutMs: number;
  providers: Record<string, ProviderConfig>;
  security: SecurityConfig;
  reporting: {
    mode: ReporterMode;
    verbose: boolean;
  };
}

export interface ResolvedExecflowConfig extends ExecflowConfig {
  configPath?: string;
  cwd: string;
  outDir: string;
}
```

### Junior engineer notes

- Raw YAML can be partial and invalid.
- `ResolvedExecflowConfig` should be complete and safe to pass to runtime.
- Do not let `allowShell` or `allowWorkflowImports` become `true` in MVP.

---

## 6.9 `src/config/defaults.ts`

**Action:** Create.  
**Purpose:** Built-in config defaults.

### Required details

```ts
import type { ExecflowConfig } from "./types.js";

export const DEFAULT_CONFIG: ExecflowConfig = {
  defaultProvider: "mock",
  concurrency: 4,
  timeoutMs: 900_000,
  providers: {
    mock: {
      command: "mock",
      args: [],
      defaultModel: null,
      responses: {
        default: { text: "mock response" }
      }
    },
    codex: {
      command: "codex",
      args: ["exec", "--json", "--ephemeral"],
      defaultModel: null
    },
    gemini: {
      command: "gemini",
      args: ["--output-format", "json"],
      defaultModel: "gemini-2.5-flash"
    }
  },
  security: {
    allowShell: false,
    allowWorkflowImports: false,
    passEnv: [],
    redactEnv: [
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "*_KEY",
      "*_TOKEN",
      "*_SECRET",
      "PASSWORD"
    ]
  },
  reporting: {
    mode: "pretty",
    verbose: false
  }
};
```

### Acceptance criteria

- Default config works without a config file.
- Default provider should be `mock` for local tests unless the team decides otherwise.
- Shell and workflow imports remain disabled.

---

## 6.10 `src/config/schema.ts`

**Action:** Create.  
**Purpose:** Validate config values after YAML parsing and merging.

### Required validation rules

- `concurrency` must be a positive integer.
- `timeoutMs` must be a positive integer.
- `defaultProvider` must exist in `providers`.
- `reporting.mode` must be `pretty`, `json`, or `jsonl`.
- each provider must have `command` as non-empty string.
- provider `args` must be an array of strings.
- `security.passEnv` must be an array of strings.
- `security.redactEnv` must be an array of strings.
- `security.allowShell` must be false for MVP.
- `security.allowWorkflowImports` must be false for MVP.

### Suggested function

```ts
import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";
import type { ExecflowConfig } from "./types.js";

export function validateConfig(config: ExecflowConfig): void {
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1) {
    throw new ExecflowError(
      ErrorCode.CONFIG_VALIDATION_ERROR,
      "Config value 'concurrency' must be a positive integer."
    );
  }

  // Continue with the other rules.
}
```

### Junior engineer notes

- Do not silently fix invalid user config.
- Error messages should say which field is invalid and what value is expected.
- Avoid printing full provider env values.

---

## 6.11 `src/config/merge.ts`

**Action:** Create.  
**Purpose:** Merge defaults, config file, and CLI overrides.

### Required details

Config precedence for Developer A:

1. CLI safety ceilings and hard overrides.
2. Config file.
3. Built-in defaults.

Agent-level precedence is handled later during runtime by Developer B/C. Developer A must preserve this rule: `--provider` sets the default provider only; it does not override explicit providers in workflow `agent()` calls.

### Suggested function

```ts
import type { ExecflowConfig } from "./types.js";

export interface ConfigCliOverrides {
  provider?: string;
  concurrency?: number;
  timeoutMs?: number;
  report?: "pretty" | "json" | "jsonl";
  verbose?: boolean;
}

export function mergeConfig(
  defaults: ExecflowConfig,
  fileConfig: Partial<ExecflowConfig>,
  cli: ConfigCliOverrides
): ExecflowConfig {
  const merged: ExecflowConfig = {
    ...defaults,
    ...fileConfig,
    providers: {
      ...defaults.providers,
      ...(fileConfig.providers ?? {})
    },
    security: {
      ...defaults.security,
      ...(fileConfig.security ?? {}),
      allowShell: false,
      allowWorkflowImports: false
    },
    reporting: {
      ...defaults.reporting,
      ...(fileConfig.reporting ?? {})
    }
  };

  if (cli.provider) merged.defaultProvider = cli.provider;
  if (cli.concurrency !== undefined) merged.concurrency = cli.concurrency;
  if (cli.timeoutMs !== undefined) merged.timeoutMs = cli.timeoutMs;
  if (cli.report) merged.reporting.mode = cli.report;
  if (cli.verbose !== undefined) merged.reporting.verbose = cli.verbose;

  return merged;
}
```

### Acceptance criteria

- CLI provider changes only `defaultProvider`.
- Explicit provider configs from YAML are preserved.
- `allowShell` cannot be enabled through config.
- `allowWorkflowImports` cannot be enabled through config.

---

## 6.12 `src/config/load.ts`

**Action:** Create.  
**Purpose:** Find, read, parse, merge, and validate config.

### Suggested interface

```ts
import type { ResolvedExecflowConfig } from "./types.js";
import type { ConfigCliOverrides } from "./merge.js";

export interface LoadConfigInput {
  cwd: string;
  configPath?: string;
  outDir?: string;
  cli: ConfigCliOverrides;
}

export async function loadConfig(input: LoadConfigInput): Promise<ResolvedExecflowConfig> {
  // 1. Determine config path.
  // 2. If file exists, parse YAML.
  // 3. Merge defaults + file config + CLI overrides.
  // 4. Validate final config.
  // 5. Return resolved config with cwd/outDir/configPath.
}
```

### Required behavior

- If `--config` is provided and the file does not exist, fail with `CONFIG_VALIDATION_ERROR`.
- If no config file exists at `.execflow/config.yaml`, use defaults.
- If YAML is invalid, fail with `CONFIG_VALIDATION_ERROR`.
- If config shape is invalid, fail with `CONFIG_VALIDATION_ERROR`.
- `cwd` should be resolved to an absolute path.
- `outDir` should default to `.execflow/runs` under `cwd` unless overridden by `--out`.

### Junior engineer notes

- Do not create directories here; Developer D owns artifact creation.
- Do not check whether Codex/Gemini binaries exist here; Developer C owns provider health checks.
- Do not pass raw YAML objects to runtime.

---

## 6.13 `src/workflow/types.ts`

**Action:** Create.  
**Purpose:** Shared workflow parser/validator types.

### Required details

```ts
export interface WorkflowMeta {
  name: string;
  description: string;
  phases?: string[];
  version?: string;
  tags?: string[];
}

export interface LoadedWorkflow {
  sourcePath: string;
  sourceText: string;
}

export interface ParsedWorkflow {
  meta: WorkflowMeta;
  body: string;
  sourcePath: string;
  sourceText: string;
  sourceHash: string;
}

export interface WorkflowValidationIssue {
  code: string;
  message: string;
  line?: number;
  column?: number;
}
```

### Junior engineer notes

- `sourceText` is the original workflow file and is used later for artifacts.
- `body` is the executable workflow body after metadata has been removed or neutralized.
- `sourceHash` helps identify exactly what was run.

---

## 6.14 `src/workflow/load.ts`

**Action:** Create.  
**Purpose:** Read workflow source from disk.

### Suggested function

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ErrorCode } from "../errors/codes.js";
import { ExecflowError } from "../errors/types.js";
import type { LoadedWorkflow } from "./types.js";

export async function loadWorkflow(pathInput: string, cwd: string): Promise<LoadedWorkflow> {
  const sourcePath = resolve(cwd, pathInput);

  try {
    const sourceText = await readFile(sourcePath, "utf8");
    return {
      sourcePath,
      sourceText: sourceText.replace(/\r\n/g, "\n")
    };
  } catch (cause) {
    throw new ExecflowError(
      ErrorCode.WORKFLOW_PARSE_ERROR,
      `Unable to read workflow file: ${sourcePath}`,
      { cause }
    );
  }
}
```

### Acceptance criteria

- Missing file fails with workflow parse error.
- Source line endings are normalized.
- Function does not parse JavaScript.
- Function does not validate workflow restrictions.

---

## 6.15 `src/workflow/parse.ts`

**Action:** Create.  
**Purpose:** Extract static workflow metadata and return executable body.

### Required metadata syntax

MVP requires the workflow file to start with:

```ts
export const meta = {
  name: "workflow-name",
  description: "workflow description"
};
```

`meta` must be the first top-level statement.

### Recommended implementation approach

For MVP, use a parser library if the project already has one. Good choices are `acorn`, `@babel/parser`, or `typescript`. If no parser is chosen yet, use the TypeScript compiler API because TypeScript is already in the project.

Do not rely only on regular expressions for final validation. Regex can be used for simple pre-checks, but metadata must be parsed structurally enough to reject dynamic expressions.

### Suggested function

```ts
import { createHash } from "node:crypto";
import type { LoadedWorkflow, ParsedWorkflow, WorkflowMeta } from "./types.js";

export function parseWorkflow(loaded: LoadedWorkflow): ParsedWorkflow {
  // 1. Parse source into AST.
  // 2. Find first top-level statement.
  // 3. Verify it is `export const meta = { ... }`.
  // 4. Convert literal object expression to WorkflowMeta.
  // 5. Remove or neutralize metadata statement from body.
  // 6. Return ParsedWorkflow.
}

function hashSource(sourceText: string): string {
  return createHash("sha256").update(sourceText).digest("hex");
}
```

### Required validation inside parser

- `meta` exists.
- `meta` is first top-level statement.
- `meta` is a literal object.
- `meta.name` is a non-empty string literal.
- `meta.description` is a non-empty string literal.
- `meta.phases`, when present, is an array of string literals.
- no computed metadata keys.
- no variables, template expressions, function calls, spreads, or imports in metadata.

### Examples

Valid:

```ts
export const meta = {
  name: "parallel-review",
  description: "Review files in parallel",
  phases: ["review", "summarize"]
};
```

Invalid:

```ts
const name = "parallel-review";

export const meta = {
  name,
  description: "Review files"
};
```

Invalid:

```ts
export const meta = {
  name: `review-${Date.now()}`,
  description: "Review files"
};
```

### Acceptance criteria

- Valid metadata returns `WorkflowMeta`.
- Missing metadata throws `WORKFLOW_PARSE_ERROR`.
- Metadata not first statement throws `WORKFLOW_PARSE_ERROR`.
- Dynamic metadata throws `WORKFLOW_PARSE_ERROR`.
- Returned `body` does not re-export `meta`.

---

## 6.16 `src/workflow/validate.ts`

**Action:** Create.  
**Purpose:** Reject unsupported or unsafe workflow behavior before runtime execution.

### Suggested interface

```ts
import type { ParsedWorkflow, WorkflowValidationIssue } from "./types.js";

export interface ValidateWorkflowOptions {
  allowImports: false;
  allowShell: false;
}

export function validateWorkflow(
  workflow: ParsedWorkflow,
  options: ValidateWorkflowOptions
): WorkflowValidationIssue[] {
  // Return all issues instead of throwing immediately.
}

export function assertWorkflowValid(
  workflow: ParsedWorkflow,
  options: ValidateWorkflowOptions
): void {
  const issues = validateWorkflow(workflow, options);
  if (issues.length > 0) {
    // Throw WORKFLOW_VALIDATION_ERROR with readable summary.
  }
}
```

### Required rejected patterns

Reject these patterns in MVP:

| Pattern | Reason |
|---|---|
| `require("fs")` | Direct module access is not allowed. |
| `import fs from "fs"` | Arbitrary imports are not allowed. |
| `import { readFile } from "node:fs"` | Filesystem access must not bypass runtime capabilities. |
| `process.env` | Direct process access is not allowed. |
| `process.cwd()` | Direct process access is not allowed. |
| `child_process` | Shell/process spawning is not allowed. |
| `fetch(...)` | Network APIs are not part of MVP workflow capabilities. |
| `shell(...)` | Shell DSL is excluded from MVP. |
| `pipeline(...)` | Pipeline is post-MVP. |
| `Date.now()` | Deterministic orchestration restriction. |
| `Math.random()` | Deterministic orchestration restriction. |

### Implementation details

Prefer AST traversal. Look for:

- `ImportDeclaration`.
- `CallExpression` with callee `require`.
- identifiers named `process`, `Buffer`, `fetch`, `WebSocket`.
- member expressions involving `fs`, `child_process`, `process`.
- calls to unsupported DSL names: `pipeline`, `shell`, `read`, `write`.
- `Date.now()` and `Math.random()`.

### Junior engineer notes

- The validator is not a perfect security sandbox. It catches common and intentional misuse.
- Do not claim malicious workflows are fully safe.
- Return all validation issues so users can fix multiple problems at once.
- Keep messages actionable, for example: `pipeline() is not supported in MVP. Use parallel() or sequential agent() calls instead.`

### Acceptance criteria

- Each restricted fixture fails.
- Valid workflows pass.
- `validate` command prints all issues.
- Runtime is not invoked when validation fails.

---

## 6.17 `src/cli/args.ts`

**Action:** Create.  
**Purpose:** Define parsed CLI option types and helper parsers.

### Required details

```ts
export type CommandName = "run" | "validate" | "doctor";
export type ReportMode = "pretty" | "json" | "jsonl";

export interface RunCliOptions {
  workflowFile: string;
  provider?: string;
  args: Record<string, string>;
  configPath?: string;
  cwd: string;
  outDir?: string;
  report: ReportMode;
  concurrency?: number;
  timeoutMs?: number;
  dryRun: boolean;
  failFast: boolean;
  verbose: boolean;
}

export interface ValidateCliOptions {
  workflowFile: string;
  configPath?: string;
  cwd: string;
  verbose: boolean;
}

export interface DoctorCliOptions {
  configPath?: string;
  cwd: string;
  verbose: boolean;
}
```

Add helpers:

```ts
export function parseKeyValueArgs(values: string[]): Record<string, string>;
export function parsePositiveInteger(value: string, optionName: string): number;
export function parseReportMode(value: string): ReportMode;
```

### Required CLI option behavior

- `--arg key=value` can appear multiple times.
- Invalid `--arg key=value` format fails with `CLI_USAGE_ERROR`.
- Invalid `--concurrency` fails with `CLI_USAGE_ERROR`.
- Invalid `--timeout-ms` fails with `CLI_USAGE_ERROR`.
- Invalid report mode fails with `CLI_USAGE_ERROR`.

### Junior engineer notes

- CLI parsing should reject bad inputs early.
- Do not let bad strings flow into config validation if the CLI option itself is malformed.

---

## 6.18 `src/cli/index.ts`

**Action:** Create.  
**Purpose:** Build the CLI program and route commands.

### Required commands

```bash
execflow run <workflow-file> [options]
execflow validate <workflow-file> [options]
execflow doctor [options]
```

### Suggested structure

```ts
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { validateCommand } from "./commands/validate.js";
import { doctorCommand } from "./commands/doctor.js";

export async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("execflow")
    .description("Orchestrate coding-agent CLI workflows")
    .version("0.0.0");

  program
    .command("run")
    .argument("<workflow-file>")
    // options here
    .action(async (workflowFile, options) => {
      await runCommand({ workflowFile, rawOptions: options });
    });

  program
    .command("validate")
    .argument("<workflow-file>")
    .action(async (workflowFile, options) => {
      await validateCommand({ workflowFile, rawOptions: options });
    });

  program
    .command("doctor")
    .action(async (options) => {
      await doctorCommand({ rawOptions: options });
    });

  await program.parseAsync(argv);
}
```

### Excluded options

Do not expose these as working options:

```bash
--allow-shell
--isolation worktree
--isolation container
--retry
```

If the team wants the CLI to recognize them, immediately fail with a clear message:

```text
--retry is not supported in the MVP.
```

### Acceptance criteria

- `execflow --help` lists MVP commands.
- `execflow run --help` lists MVP run options only.
- Unknown command exits with `2`.
- Missing workflow file exits with `2`.

---

## 6.19 `src/cli/print.ts`

**Action:** Create.  
**Purpose:** Small helpers for CLI text output that are not full reporters.

### Required details

Use this only for:

- validation success/failure messages.
- dry-run summaries.
- doctor summaries until Developer D reporter integration exists.

Suggested helpers:

```ts
export function printValidationSuccess(workflowName: string): void;
export function printValidationIssues(issues: readonly { message: string }[]): void;
export function printDryRunSummary(summary: DryRunSummary): void;
```

### Junior engineer notes

- Do not implement the pretty runtime reporter here.
- Do not print normal logs to stdout in JSON/JSONL modes after reporter integration.

---

## 6.20 `src/cli/commands/validate.ts`

**Action:** Create.  
**Purpose:** Implement `execflow validate <workflow-file>`.

### Flow

1. Parse CLI options.
2. Load config only if needed for validation settings.
3. Load workflow source.
4. Parse metadata.
5. Validate workflow restrictions.
6. Print success or issues.
7. Exit with `0` for success or throw `WORKFLOW_VALIDATION_ERROR` for failure.

### Suggested function

```ts
export interface ValidateCommandInput {
  workflowFile: string;
  rawOptions: unknown;
}

export async function validateCommand(input: ValidateCommandInput): Promise<void> {
  // Implement command flow.
}
```

### Output examples

Success:

```text
✓ Workflow is valid: parallel-review
```

Failure:

```text
✕ Workflow validation failed: examples/bad.js

1. Metadata must be the first top-level statement.
2. pipeline() is not supported in the MVP.
```

### Acceptance criteria

- Does not invoke runtime.
- Does not create run artifacts.
- Does not call providers.
- Fails with exit code `3` for parse/validation problems.

---

## 6.21 `src/cli/commands/run.ts`

**Action:** Create.  
**Purpose:** Implement `execflow run <workflow-file>` command orchestration.

### Flow

1. Parse CLI options.
2. Load and resolve config.
3. Load workflow source.
4. Parse metadata.
5. Validate workflow restrictions.
6. If `--dry-run`, print summary and return success.
7. Otherwise call `RuntimeRunner.run(...)`.
8. Map final workflow status to process exit code.

### Suggested function

```ts
import type { RuntimeRunner } from "../../runtime/public.js";

export interface RunCommandDeps {
  runtimeRunner: RuntimeRunner;
}

export interface RunCommandInput {
  workflowFile: string;
  rawOptions: unknown;
  deps?: Partial<RunCommandDeps>;
}

export async function runCommand(input: RunCommandInput): Promise<void> {
  // Implement command flow.
}
```

### Dry-run output requirements

`execflow run workflow.js --dry-run` should show:

- workflow file path.
- workflow name.
- workflow description.
- declared phases.
- resolved default provider.
- resolved concurrency.
- resolved timeout.
- report mode.
- artifacts output root.
- clear statement that providers were not invoked.

Example:

```text
Dry run: parallel-review

Workflow file: examples/parallel-review.js
Description: Review changed files with multiple coding-agent CLIs
Phases: review, summarize
Default provider: mock
Concurrency: 4
Timeout: 900000 ms
Report mode: pretty
Artifacts root: .execflow/runs

No providers were invoked.
```

### Runtime handoff payload

Pass these to Developer B runtime:

```ts
{
  parsedWorkflow,
  config,
  cli: {
    workflowFile,
    provider,
    args,
    cwd,
    outDir,
    report,
    concurrency,
    timeoutMs,
    dryRun,
    failFast,
    verbose
  }
}
```

### Acceptance criteria

- Invalid workflow fails before runtime.
- `--dry-run` does not invoke runtime or providers.
- Non-dry run calls only the runtime runner interface.
- Failed runtime result maps to exit code `1` unless it carries a more specific error.

---

## 6.22 `src/cli/commands/doctor.ts`

**Action:** Create.  
**Purpose:** Implement `execflow doctor` command shell.

### Flow

1. Parse CLI options.
2. Load config.
3. Call `ProviderHealthChecker.checkAll(config)`.
4. Print concise provider readiness summary.
5. Exit `0` if required checks pass.
6. Exit `4` if provider CLI is unavailable when required.

### Suggested function

```ts
import type { ProviderHealthChecker } from "../../doctors/public.js";

export interface DoctorCommandDeps {
  providerHealthChecker: ProviderHealthChecker;
}

export async function doctorCommand(input: {
  rawOptions: unknown;
  deps?: Partial<DoctorCommandDeps>;
}): Promise<void> {
  // Implement command flow.
}
```

### Output example

```text
execflow doctor

✓ mock    available
✓ codex   available: codex exec --help succeeded
✕ gemini  unavailable: command not found

Provider check failed: gemini is unavailable.
```

### Junior engineer notes

- Developer A should not implement actual binary checks if Developer C is working on them.
- Provide a simple fake checker for tests.
- Do not print auth tokens or environment variable values.

---

## 6.23 `src/runtime/public.ts`

**Action:** Create small interface file only.  
**Purpose:** Let Dev A compile before Dev B runtime is complete.

### Required details

```ts
import type { ResolvedExecflowConfig } from "../config/types.js";
import type { ParsedWorkflow } from "../workflow/types.js";

export interface RuntimeRunInput {
  parsedWorkflow: ParsedWorkflow;
  config: ResolvedExecflowConfig;
  cli: {
    workflowFile: string;
    provider?: string;
    args: Record<string, string>;
    cwd: string;
    outDir?: string;
    report: "pretty" | "json" | "jsonl";
    concurrency?: number;
    timeoutMs?: number;
    dryRun: boolean;
    failFast: boolean;
    verbose: boolean;
  };
}

export interface WorkflowRunResult {
  schemaVersion: "execflow.report.v1";
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  durationMs: number;
  artifactsDir: string;
  error?: unknown;
}

export interface RuntimeRunner {
  run(input: RuntimeRunInput): Promise<WorkflowRunResult>;
}
```

### Acceptance criteria

- Dev A commands depend only on this interface.
- Dev B can replace or expand implementation later without changing CLI code.

---

## 6.24 `src/doctors/public.ts`

**Action:** Create small interface file only.  
**Purpose:** Let Dev A compile before Dev C provider checks are complete.

### Required details

```ts
import type { ResolvedExecflowConfig } from "../config/types.js";

export interface ProviderHealth {
  provider: string;
  ok: boolean;
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  providers: ProviderHealth[];
}

export interface ProviderHealthChecker {
  checkAll(config: ResolvedExecflowConfig): Promise<DoctorResult>;
}
```

---

## 7. Test Plan

Developer A should write tests before integrating with runtime/provider code. Use fakes and fixtures.

## 7.1 CLI tests

### `tests/unit/cli/args.test.ts`

Test cases:

- parses `--arg foo=bar`.
- parses repeated `--arg` flags.
- rejects `--arg foo`.
- rejects `--concurrency 0`.
- rejects `--concurrency abc`.
- rejects `--timeout-ms 0`.
- rejects `--report xml`.

### `tests/unit/cli/validate-command.test.ts`

Test cases:

- valid workflow prints success.
- invalid workflow throws `WORKFLOW_VALIDATION_ERROR`.
- command does not call runtime.
- command does not call provider checker.

### `tests/unit/cli/run-command.test.ts`

Test cases:

- valid dry-run does not call runtime.
- valid non-dry-run calls runtime once.
- invalid workflow fails before runtime.
- runtime failed result maps to workflow failure.
- CLI provider sets default provider in config.

---

## 7.2 Config tests

### `tests/unit/config/load-config.test.ts`

Test cases:

- no config file uses defaults.
- explicit missing `--config` fails.
- invalid YAML fails.
- valid YAML loads.
- `cwd` resolves to absolute path.
- `outDir` resolves correctly.

### `tests/unit/config/merge-config.test.ts`

Test cases:

- CLI provider overrides default provider.
- CLI concurrency overrides config.
- CLI timeout overrides config.
- CLI report overrides config.
- provider configs merge instead of replace all providers.
- `allowShell: true` in config is forced or rejected as false.

---

## 7.3 Workflow parser tests

### `tests/unit/workflow/parse-metadata.test.ts`

Test cases:

- valid metadata parses.
- valid phases parse.
- missing metadata fails.
- metadata not first fails.
- missing name fails.
- empty name fails.
- missing description fails.
- dynamic name fails.
- dynamic description fails.
- dynamic phases fail.
- spread properties fail.
- computed properties fail.

---

## 7.4 Workflow validator tests

### `tests/unit/workflow/validate-workflow.test.ts`

Test cases:

- valid workflow passes.
- `require()` fails.
- `import` fails.
- `process.env` fails.
- `process.cwd()` fails.
- `fetch()` fails.
- `shell()` fails.
- `pipeline()` fails.
- `Date.now()` fails.
- `Math.random()` fails.

---

## 7.5 Error tests

### `tests/unit/errors/exit-codes.test.ts`

Test cases:

- `CLI_USAGE_ERROR` -> `2`.
- `WORKFLOW_PARSE_ERROR` -> `3`.
- `WORKFLOW_VALIDATION_ERROR` -> `3`.
- `PROVIDER_UNAVAILABLE` -> `4`.
- `SECURITY_POLICY_VIOLATION` -> `5`.
- `USER_CANCELLED` -> `6`.
- `PROCESS_TIMEOUT` -> `7`.
- unknown error -> `8`.

---

## 8. Workflow Fixtures

Create these files in `tests/fixtures/workflows/`.

### `valid-simple.js`

```js
export const meta = {
  name: "valid-simple",
  description: "A valid simple workflow"
};

phase("review");
log("hello");

export default { ok: true };
```

### `valid-with-phases.js`

```js
export const meta = {
  name: "valid-with-phases",
  description: "A valid workflow with phases",
  phases: ["scan", "review", "summarize"]
};

phase("scan");
phase("review");
phase("summarize");

export default { ok: true };
```

### `invalid-missing-meta.js`

```js
phase("review");
export default {};
```

### `invalid-meta-not-first.js`

```js
const x = 1;

export const meta = {
  name: "bad",
  description: "Metadata is not first"
};

export default {};
```

### `invalid-dynamic-meta.js`

```js
export const meta = {
  name: `bad-${Date.now()}`,
  description: "Dynamic metadata is not allowed"
};

export default {};
```

### `invalid-require.js`

```js
export const meta = {
  name: "invalid-require",
  description: "Uses require"
};

const fs = require("fs");
export default {};
```

### `invalid-import.js`

```js
export const meta = {
  name: "invalid-import",
  description: "Uses import"
};

import fs from "fs";
export default {};
```

### `invalid-process.js`

```js
export const meta = {
  name: "invalid-process",
  description: "Uses process"
};

const cwd = process.cwd();
export default { cwd };
```

### `invalid-fs.js`

```js
export const meta = {
  name: "invalid-fs",
  description: "Uses fs"
};

const text = fs.readFileSync("package.json", "utf8");
export default { text };
```

### `invalid-pipeline.js`

```js
export const meta = {
  name: "invalid-pipeline",
  description: "Uses post-MVP pipeline"
};

const result = await pipeline([], x => x);
export default result;
```

---

## 9. Example Workflow

Create `examples/parallel-review.js` for manual testing.

```js
export const meta = {
  name: "parallel-review",
  description: "Review changed files with multiple coding-agent CLIs",
  phases: ["review", "summarize"]
};

phase("review");

const reviews = await parallel({
  codex: () => agent({
    id: "codex-review",
    provider: "codex",
    prompt: "Review the changed files for correctness issues."
  }),
  gemini: () => agent({
    id: "gemini-review",
    provider: "gemini",
    prompt: "Review the changed files for API design issues."
  })
});

phase("summarize");

const summary = await agent({
  id: "summary",
  provider: "mock",
  prompt: `Summarize these reviews:\n${JSON.stringify(reviews, null, 2)}`
});

export default {
  reviews,
  summary
};
```

---

## 10. Pull Request Breakdown

Developer A should split work into small pull requests.

### PR A1 — Error model and CLI skeleton

Files:

```text
package.json
tsconfig.json
src/index.ts
src/errors/codes.ts
src/errors/types.ts
src/errors/serialize.ts
src/errors/exit-codes.ts
src/cli/index.ts
```

Acceptance:

- `execflow --help` works.
- error code tests pass.
- unknown command returns `2`.

### PR A2 — Config loader

Files:

```text
src/config/types.ts
src/config/defaults.ts
src/config/schema.ts
src/config/merge.ts
src/config/load.ts
tests/unit/config/load-config.test.ts
tests/unit/config/merge-config.test.ts
tests/fixtures/config/*.yaml
```

Acceptance:

- defaults load without config.
- YAML config loads.
- invalid config fails clearly.
- CLI overrides work.

### PR A3 — Workflow loader and parser

Files:

```text
src/workflow/types.ts
src/workflow/load.ts
src/workflow/parse.ts
tests/unit/workflow/load-workflow.test.ts
tests/unit/workflow/parse-metadata.test.ts
tests/fixtures/workflows/valid-*.js
tests/fixtures/workflows/invalid-missing-meta.js
tests/fixtures/workflows/invalid-meta-not-first.js
tests/fixtures/workflows/invalid-dynamic-meta.js
```

Acceptance:

- valid metadata parses.
- invalid metadata fails with workflow parse error.
- source hash is stable.

### PR A4 — Workflow validator

Files:

```text
src/workflow/validate.ts
tests/unit/workflow/validate-workflow.test.ts
tests/fixtures/workflows/invalid-require.js
tests/fixtures/workflows/invalid-import.js
tests/fixtures/workflows/invalid-process.js
tests/fixtures/workflows/invalid-fs.js
tests/fixtures/workflows/invalid-pipeline.js
```

Acceptance:

- valid workflows pass.
- restricted APIs fail.
- unsupported DSL calls fail.
- validation reports all issues it finds.

### PR A5 — Validate and dry-run commands

Files:

```text
src/cli/args.ts
src/cli/print.ts
src/cli/commands/validate.ts
src/cli/commands/run.ts
tests/unit/cli/args.test.ts
tests/unit/cli/validate-command.test.ts
tests/unit/cli/run-command.test.ts
examples/parallel-review.js
```

Acceptance:

- `execflow validate` works end to end.
- `execflow run --dry-run` works end to end.
- runtime is not called in dry-run mode.

### PR A6 — Runtime and doctor handoff

Files:

```text
src/runtime/public.ts
src/doctors/public.ts
src/cli/commands/run.ts
src/cli/commands/doctor.ts
```

Acceptance:

- non-dry `run` calls `RuntimeRunner`.
- `doctor` calls `ProviderHealthChecker`.
- tests use fake runtime and fake doctor checker.

---

## 11. Manual Verification Commands

Run these after each relevant PR.

```bash
pnpm install
pnpm build
pnpm test:types
pnpm test
```

After CLI skeleton:

```bash
pnpm build
node dist/index.js --help
node dist/index.js run --help
node dist/index.js validate --help
node dist/index.js doctor --help
```

After parser and validator:

```bash
node dist/index.js validate tests/fixtures/workflows/valid-simple.js
node dist/index.js validate tests/fixtures/workflows/invalid-pipeline.js
```

After dry-run:

```bash
node dist/index.js run examples/parallel-review.js --dry-run --provider mock
node dist/index.js run examples/parallel-review.js --dry-run --provider mock --report json
```

After runtime handoff integration:

```bash
node dist/index.js run examples/parallel-review.js --provider mock --report pretty
```

---

## 12. Common Mistakes to Avoid

### Mistake 1: Implementing runtime inside the CLI

The CLI should load, validate, and hand off. It should not execute workflow logic directly.

### Mistake 2: Treating `--provider` as a force override

`--provider codex` sets the default provider only. If a workflow has `agent({ provider: "gemini" })`, that explicit provider should still win.

### Mistake 3: Letting config enable excluded MVP features

Even if config says `allowShell: true`, MVP must keep shell disabled or reject the config.

### Mistake 4: Using regex only for metadata validation

Regex will miss dynamic expressions and edge cases. Use AST parsing for final validation.

### Mistake 5: Throwing after the first workflow validation issue

Return as many validation issues as possible so users can fix workflows faster.

### Mistake 6: Printing secrets in errors

Never print full environment maps, raw provider env config, or token-like values.

### Mistake 7: Calling providers during `validate` or `--dry-run`

Validation and dry run must not invoke Codex, Gemini, or mock providers.

---

## 13. Definition of Done for Developer A

Developer A is done when:

- `execflow --help` works.
- `execflow run --help` shows only MVP options.
- `execflow validate <workflow-file>` validates metadata and restrictions.
- `execflow run <workflow-file> --dry-run` loads config, parses workflow, validates workflow, and prints a useful summary without invoking runtime/providers.
- `execflow run <workflow-file>` calls the runtime runner interface.
- `execflow doctor` calls the provider health checker interface.
- `.execflow/config.yaml` is optional.
- explicit `--config` path is validated.
- config defaults are complete.
- config errors are clear and deterministic.
- exit codes match the MVP table.
- unit tests cover CLI, config, parser, validator, and errors.
- no excluded MVP feature is accidentally enabled.

---

## 14. Integration Checklist with Other Developers

### With Developer B

Confirm:

- `RuntimeRunner.run(input)` signature.
- `RunCliOptions` shape.
- how workflow args are passed into runtime.
- how runtime reports final success/failure to CLI.

### With Developer C

Confirm:

- `ProviderHealthChecker.checkAll(config)` signature.
- provider names: `mock`, `codex`, `gemini`.
- config provider shape.
- unavailable provider error mapping.

### With Developer D

Confirm:

- `outDir` meaning and default.
- whether `run --dry-run` should print directly or use reporter later.
- JSON/JSONL stdout restrictions after reporter integration.
- final report status mapping to CLI exit code.

---

## 15. Final Acceptance Scenario

This scenario should pass after Developer A integrates with the other lanes.

```bash
execflow validate examples/parallel-review.js
```

Expected:

```text
✓ Workflow is valid: parallel-review
```

```bash
execflow run examples/parallel-review.js --provider mock --dry-run
```

Expected:

```text
Dry run: parallel-review
No providers were invoked.
```

```bash
execflow doctor
```

Expected with only mock available:

```text
✓ mock    available
✕ codex   unavailable: command not found
✕ gemini  unavailable: command not found
```

```bash
execflow run examples/parallel-review.js --provider mock --report pretty
```

Expected after full team integration:

- workflow runs through runtime.
- mock provider is used unless workflow explicitly chooses another provider.
- artifacts are created by Developer D components.
- final exit code is `0` for success.
