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
--resume <run-id-or-path>
--no-cache
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
openflow run workflows/review.ts --resume <previous-run-id>
openflow run workflows/review.ts --no-cache
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

---

## Check environment readiness

```bash
openflow doctor
```

### Checks include

* config file can be loaded.
* provider CLIs are present when configured.
* Codex CLI is available for Codex workflows.
* Gemini CLI is available for Gemini workflows.
* provider commands can be executed.
* secret-like environment values are not printed.
