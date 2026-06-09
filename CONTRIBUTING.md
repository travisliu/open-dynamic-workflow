# Contributing

OpenFlow is an local-first workflow CLI. Keep changes focused on orchestration, provider adapters, validation, reporting, and durable artifacts.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Use the mock provider for tests and examples that should not require real provider credentials.

## Pull Requests

- Keep provider-specific logic inside provider adapters.
- Do not make the workflow runtime spawn provider processes directly.
- Do not add production dependencies without a concrete MVP need.
- Update tests and documentation for user-visible behavior changes.
- Do not commit secrets, provider credentials, `.openflow/runs/`, `dist/`, or local tool logs.
