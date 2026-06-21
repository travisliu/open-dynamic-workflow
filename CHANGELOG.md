# Changelog

All notable changes to this project will be documented in this file.

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
