# Changelog

All notable changes to this project will be documented in this file.

## [0.6.0] - 2026-07-29

### Added

- **Run-Scoped Workflow Context**: Added the global `context` API for JSON-safe run state. Workflows, child workflows, pipeline stages, and loop rounds can read, write, merge, append, delete, snapshot, and scope state by key path. Context operations validate paths and values, enforce size limits, and reject prototype-pollution keys.
- **Configuration Profiles**: Added named profiles with inheritance and external profile catalogs. Select profiles with `--profile` and load catalogs with `--profiles`; resolved profile metadata is included in artifacts and reports to make runs and resumes auditable.
- **Provider Aliases**: Added validated, inheritable execution presets through `providerAliases`. An `agent()` provider reference can now resolve to an alias that supplies a concrete provider, model, thinking effort, timeout, and retry policy without exposing provider command or permission settings to workflow code.
- **Provider-Selection Reporting and Cache Safety**: Reports, JSONL events, and artifacts now record requested and resolved provider selections, alias chains, setting sources, and diagnostics. Alias identity and digest are included in agent cache fingerprints so relevant configuration changes invalidate cached calls.
- **Configurable Artifact Runs Roots**: Added global and profile `outDir` settings plus the `run --out` and `resume --out` overrides. Runs use the unambiguous `<runsRoot>/<runId>` layout, and new run-input records preserve output-root provenance while remaining compatible with existing v1 records.
- **Artifact-Root Doctor Checks**: `doctor` now validates the resolved global or profile artifact runs root, creates it when needed, checks writeability with a temporary exclusive probe, and reports the resolved location.
- **Host-Compatible Tool Runtime Loading**: Tools can use the host-provided runtime globals and compatible module loading path. Project initialization now generates a `globals.d.ts` declaration file for `defineTool`.
- **Documentation Website**: Added the project documentation site and GitHub Pages deployment workflow.

### Changed & Improved

- **Simplified Workflow Context Model**: Context is now one shared run-scoped global store, accessed as `context`; child workflows and callbacks share it directly. The previously proposed per-construct context options, overlays, inheritance rules, and `ctx.context` form are not supported.
- **Artifact-Root Resolution and Resume Behavior**: Runs-root selection now has explicit precedence (`--out`, selected profile, top-level configuration, then the default). Bare resume IDs use a bounded current-root then legacy-root lookup, explicit paths are used directly, and every continuation writes to a fresh directory under the current effective root.
- **No-Write Inspection Commands**: Normal `init`, `list`, `validate`, and dry-run commands no longer create or readiness-probe artifact runs roots. Generated configuration explicitly includes the default runs root.
- **More Deterministic Tool Loading**: Tool definitions are loaded through a compatibility layer that supplies runtime globals while preserving isolation and serialized access to shared runtime state. Templates and initialization output were updated for the current tool authoring model.
- **Provider Resolution Is Authoritative**: Provider, model, thinking-effort, timeout, and retry resolution is centralized before execution. CLI validation, doctor output, workflow validation, adapters, retries, artifacts, and reporters use the same resolved selection.
- **Release and Packaging Hardening**: The build now copies runtime assets needed by packed CLI installations, and package-level acceptance coverage exercises the packed executable.

### Fixed

- **Workflow Context Boundary Hardening**: Hardened the workflow sandbox context boundary against prototype-pollution inputs.
- **Artifact-Root Safety**: Prevented duplicate run-ID path nesting and unintended output-root writes during inspection commands.

## [0.5.0] - 2026-07-07

### Added

- **Experimental Retry Support**: Implemented a comprehensive runtime scheduling and execution framework for automatic agent call retries. Features include:
  - Retry policy resolution, attempt scheduling, cache fingerprinting, and backoff delay service (with optional jitter).
  - Attempt-level artifact tracking, persistent logging, and integration/cache regression tests.
- **Unified Path Configuration for Resource Discovery**: Introduced a unified `discovery` path configuration for locating workflows, agents, and tools, with support for source-aware warning behavior.
- **Glob Engine Integration (`tinyglobby`)**: Replaced custom globbing logic with `tinyglobby` for pattern compilation and matching.

### Changed & Improved

- **Source-Aware Path Discovery Redesign**: Centralized loader handoffs, pattern exclusion matching, policy evaluation, and precollection for cleaner and warning-preserving resource resolution.
- **Provider Prompt Transport Hardening**: Hardened provider prompt transport against `spawn E2BIG` errors.
- **Legacy Cleanup**: Removed remaining legacy `@prmflow/openflow` and old `openflow` package references, exports, structures, and legacy loader discovery branches.

### Fixed

- **Registry Lookup & Setup Safety**: Wrapped agent registry lookup and provider setup in try-catch blocks to prevent unhandled promise rejections on configuration/setup errors.
- **Metadata Const Ordering**: Allowed same-file local `const` tool metadata references in tool listings, while preventing forward metadata const references.
- **Shared Agent ID Propagation**: Fixed the shared-agent ID propagation issue to ensure that parallel shared-agent calls inside loop rounds receive distinct agent execution IDs (inheriting the outer DSL call ID when inner IDs are absent), preventing ID collisions, shared-artifact directory overlaps, and cache/resume corruption.

## [0.4.0] - 2026-06-25

### Added

- **Agent Thinking Effort (`thinkingEffort`)**: Added support for configuring reasoning/thinking effort levels on agent calls. Users can set the `thinkingEffort` parameter directly in `agent()` DSL calls or set a default via the `defaultThinkingEffort` configuration. Supports mappings and validations for `codex` (via `-c model_reasoning_effort`), `pi` (via `--thinking`), and `opencode` (via `--variant`) providers, adhering to resolution precedence rules.
- **Tool DSL Execution in Loops**: Added support for executing deterministic tools inside loop round callbacks via the loop round context. The loop round context now exposes `ctx.tool(input)` and `ctx.toolId(suffix)` which bypass the global tool restriction inside loop rounds. Uses deterministic tool ID generation to ensure proper integration with execution resume and cache replay.
- **Max Agent Calls Limit**: Added a run limit safety guardrail to prevent infinite agent call loops. The limit is configurable via `--max-agent-calls` CLI option (on `run`/`resume`) and `maxAgentCalls` project configuration. Exceeding the limit halts execution with a `RUN_LIMIT_EXCEEDED` code.
- **Project Configuration Hints**: Added CLI initialization hints (`PROJECT_INIT_MISSING`) when `.open-dynamic-workflow/config.yaml` is missing, showing commands to bootstrap directories and configuration depending on the resolved CLI executable name (`odw` or `open-dynamic-workflow`).
- **Durable Ultra-Loop Example**: Added a comprehensive workflow example (`ultra-loop`) showcasing evidence-gated loop execution, checkpoint saving, steering, and quality reviews in a self-contained directory.

### Changed & Improved

- **GitHub Actions CI Workflow**: Added CI configuration `.github/workflows/ci.yml` running linting, typechecking, building, and unit tests on Node versions 20.x and 22.x.
- **Test Infrastructure Stability**: Fixed filesystem mocks for `readdir` and `stat` in CLI test suites and increased vitest package execution test timeouts to 60s to ensure reliable CI runs.
- **Git Config**: Updated gitignore configuration to ignore the `plans` directory instead of `docs`.

## [0.3.5] - 2026-06-21


### Added

- **Loop DSL Primitive**: Introduced the stateful `loop(input)` primitive to the Workflow DSL for goal-oriented, repeated callback execution. Features robust round-by-round state transitions, failure mode options ("throw" or "settled"), deterministic sub-agent ID mapping, execution timeouts, persistent round artifact tracking, and rich visual status updates in pretty/JSON/JSONL reporters.

- **Cursor Agent Integration**: Added the `cursor` provider adapter to support orchestrating tasks through the Cursor Agent CLI, featuring trust flags, custom modes and models, workspace targets, and graceful plain-text parsing fallback.

- **Linting & Code Health**: Integrated ESLint 10.x with flat configuration (`eslint.config.js`) and resolved all lint warnings, unused variables, types, and imports across the entire codebase.

- **Log Event Data Previews**: Extended the workflow log output to format and display optional event data payloads (such as quality gate results) with structured indentation.

### Fixed
- **Pretty Reporter Output**: Fixed formatting to ensure quality gate logs and other workflow logs with attached context display their event data payloads correctly in the pretty reporter.


## [0.3.0] - 2026-06-16

### Added
- **Shared Agents**: Introduce support for defining, validating, loading, and executing reusable shared agent definitions across workflows.
- **Child Workflows (Nested Workflows)**: Support invoking child workflows within a parent workflow context with structured output collection, error propagation, and nested cancellation.
- **Project Scaffolding (`init` command)**: Added the `init` command to easily bootstrap a new project config (`config.yaml`), agent directories, tool directories, and starter workflows.
- **Name-Based Execution**: Allow validating and running workflows by their declared name (`meta.name`) in addition to direct file paths.
- **Resource Discovery (`list` command)**: Added a command to discover and list all registered workflows, agents, and tools in the current project.
- **New Provider Adapters**: Integrated support for GitHub Copilot CLI, antigravity-cli, opencode-cli, and pi-coding-agent.
- **Resumable Cache**: Implemented resumable cache support for tools, including result replay and strict path traversal safety validations.

### Refactored & Improved
- **Project Renaming**: Renamed the package, CLI binary, skills directory, configurations, and documentation from `openflow` (or `@prmflow/openflow`) to `@travisliu/open-dynamic-workflow` (CLI executable `open-dynamic-workflow` / alias `odw`).
- **Event-Driven Pretty Reporter**: Refactored the pretty reporter into a modular, event-driven architecture, separating tree aggregation, status rendering, and format styling.
- **Cache Normalization**: Cleaned up materialized results to remove undefined properties from cache files.
- **Test Infrastructure**: Increased Vitest package execution and global installation test timeouts to 30s to ensure consistent CI runs.
