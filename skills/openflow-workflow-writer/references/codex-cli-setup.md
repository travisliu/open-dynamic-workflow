# Codex CLI Setup Notes

Short notes from real OpenFlow + Codex CLI runs.

## Run the right OpenFlow entrypoint

From this repository:

```bash
node dist/index.js run examples/workflow.js
```

or use the installed CLI:

```bash
openflow run examples/workflow.js
```

Do not run `node dist/cli/index.js run ...` directly. It exports `main()` but does not call it.

## Expected Codex command

The default adapter should launch Codex like:

```bash
codex -C <cwd> -s read-only -a never exec --json -o <last-message-file> --ephemeral
```

With schema, OpenFlow also passes:

```bash
--output-schema <schema-file>
```

Do not set `providers.codex.args` unless you intentionally want to replace this built-in command path. Setting custom args means OpenFlow will not add `-C`, `-o`, `--ephemeral`, or `--output-schema` for you.

## Timeout and proxy

If Codex CLI prints JSONL errors such as:

```json
{"type":"error","message":"Reconnecting... 2/5 (request timed out)"}
```

that is usually a Codex CLI/network issue rather than a workflow-script issue. Try a larger timeout:

```bash
openflow run examples/workflow.js --timeout-ms 240000
```

If direct network access fails, run with standard proxy variables:

```bash
HTTPS_PROXY=http://127.0.0.1:<port> \
HTTP_PROXY=http://127.0.0.1:<port> \
ALL_PROXY=socks5://127.0.0.1:<port> \
openflow run examples/workflow.js
```

## Quick checks

```bash
codex --version
codex exec --help
openflow doctor
openflow validate examples/workflow.js
```

Inspect failed runs under:

```bash
.openflow/runs/<runId>/
```
