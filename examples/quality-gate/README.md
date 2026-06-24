# Quality Gate

This example repeatedly runs the repository's npm test, lint, and build quality
gates. When structured issues are found, a write-capable fixer agent attempts
to resolve them before the next round.

## Layout

```text
examples/quality-gate/
├── README.md
├── config.yaml
├── agents/
│   └── quality-gate-fixer.agent.js
├── tools/
│   └── npm-quality-gate.js
└── workflows/
    └── demo-quality-gate.js
```

Run commands from the repository root.

## Validate

```bash
odw validate examples/quality-gate/workflows/demo-quality-gate.js \
  --config examples/quality-gate/config.yaml
```

## Run

```bash
odw run examples/quality-gate/workflows/demo-quality-gate.js \
  --config examples/quality-gate/config.yaml
```

The workflow runs at most five rounds. Each loop round directly:

1. Runs the `npm-quality-gate` tool.
2. Extracts structured test, lint, and build issues.
3. Invokes `quality-gate-fixer` when issues remain.
4. Stops when no structured issues remain.

The fixer agent uses `permissions: { mode: "dangerously-full-access" }` because
it must modify the workspace and rerun checks autonomously.
