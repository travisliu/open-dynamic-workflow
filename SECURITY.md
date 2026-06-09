# Security Policy

## Reporting a Vulnerability

Report suspected vulnerabilities privately through the GitHub repository security advisory flow or by opening a minimal issue that does not include exploit details or secrets.

## Scope

OpenFlow orchestrates external coding-agent CLIs. It is not a complete sandbox, and provider CLIs may access files, network, and credentials according to their own behavior and permissions.

By default, workflow code cannot use shell execution, arbitrary imports, filesystem APIs, or process APIs. Environment variables are passed to providers only when allowlisted, and secret-like values are redacted where feasible.

## Redaction

OpenFlow treats these names as secret-like by default:

- `*_KEY`
- `*_TOKEN`
- `*_SECRET`
- `PASSWORD`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
