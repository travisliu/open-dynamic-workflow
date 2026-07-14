import { Link } from "react-router-dom";
import CodeBlock, { BashBlock } from "../components/CodeBlock";

const GITHUB_URL = "https://github.com/travisliu/open-dynamic-workflow";
const NPM_URL = "https://www.npmjs.com/package/@travisliu/open-dynamic-workflow";

const PROVIDERS = [
  { name: "codex", label: "Codex CLI" },
  { name: "gemini", label: "Gemini CLI" },
  { name: "copilot", label: "GitHub Copilot" },
  { name: "opencode", label: "OpenCode" },
  { name: "antigravity", label: "Antigravity" },
  { name: "pi", label: "Pi Agent" },
  { name: "cursor", label: "Cursor" },
  { name: "mock", label: "Mock (built-in)" },
];

const WORKFLOW_EXAMPLE = `import { agent, parallel, phase } from "@travisliu/open-dynamic-workflow";

export const meta = {
  name: "parallel-pr-review",
  description: "Run security, correctness and test reviews in parallel",
  phases: ["review", "summarize"],
};

export default async function () {
  phase("review");

  const [security, correctness, tests] = await parallel([
    () => agent({
      id: "security-review",
      provider: "codex",
      prompt: "Review this change for security risks.",
    }),
    () => agent({
      id: "correctness-review",
      provider: "codex",
      prompt: "Review this change for logic and correctness.",
    }),
    () => agent({
      id: "test-review",
      provider: "gemini",
      prompt: "Review tests for coverage and edge cases.",
    }),
  ]);

  phase("summarize");

  const summary = await agent({
    id: "summarize",
    provider: "gemini",
    prompt: \`Summarize findings:\\n\${security.content}\\n\${correctness.content}\\n\${tests.content}\`,
  });

  return { security, correctness, tests, summary };
}`;

const FEATURES = [
  {
    icon: "⚡",
    iconClass: "blue",
    title: "Version-Controlled Workflows",
    body: "Workflows are explicit TypeScript scripts — reviewed, committed, and reproducible across your team.",
  },
  {
    icon: "⚙",
    iconClass: "purple",
    title: "Provider-Agnostic",
    body: "Swap between Codex, Gemini, Copilot, or any supported CLI without changing your workflow logic.",
  },
  {
    icon: "◈",
    iconClass: "green",
    title: "Parallel & Pipeline",
    body: "Run independent reviews concurrently with parallel(), or process many items through ordered stages with pipeline().",
  },
  {
    icon: "◎",
    iconClass: "orange",
    title: "Structured Output",
    body: "Define JSON schemas for agent responses. Validation failures produce failed results, not internal crashes.",
  },
  {
    icon: "⊙",
    iconClass: "indigo",
    title: "Run Artifacts",
    body: "Every run persists prompts, stdout, stderr, normalized output, and a full event log for debugging.",
  },
  {
    icon: "⟳",
    iconClass: "rose",
    title: "Resume & Cache",
    body: "Resume interrupted runs and replay cached agent calls to avoid repeating expensive provider calls.",
  },
];

const PATTERNS = [
  {
    title: "Single Agent",
    description: "One agent completes the task.",
    tag: "Basic",
    tagClass: "badge-neutral",
  },
  {
    title: "Parallel Review",
    description: "Multiple independent reviews run at the same time.",
    tag: "Concurrency",
    tagClass: "badge-blue",
  },
  {
    title: "Pipeline",
    description: "Many items pass through the same ordered stages.",
    tag: "Multi-item",
    tagClass: "badge-blue",
  },
  {
    title: "Fan-out / Fan-in",
    description: "Multiple branches run, then a final agent summarizes.",
    tag: "Aggregation",
    tagClass: "badge-green",
  },
  {
    title: "Loop",
    description: "Repeated execution until a terminal condition is met.",
    tag: "Stateful",
    tagClass: "badge-orange",
  },
  {
    title: "Child Workflow",
    description: "Compose larger workflows from reusable smaller ones.",
    tag: "Composition",
    tagClass: "badge-neutral",
  },
];

export default function HomePage() {
  return (
    <div style={{ paddingTop: "var(--topbar-height)" }}>
      {/* Hero */}
      <section className="hero">
        <div className="hero-eyebrow">
          <span>◎</span> Local-first agent orchestration
        </div>
        <h1>
          Workflow scripts for{" "}
          <span>coding-agent CLIs</span>
        </h1>
        <p className="hero-description">
          Open Dynamic Workflow turns repeatable agent tasks into explicit, version-controlled
          workflow scripts — so execution is validated, reproducible, and easy to debug.
        </p>
        <div className="hero-actions">
          <Link to="/guides" className="btn-primary">
            Get started →
          </Link>
          <a
            href={GITHUB_URL}
            className="btn-secondary"
            target="_blank"
            rel="noreferrer noopener"
          >
            View on GitHub
          </a>
        </div>

        {/* Install command */}
        <div className="hero-install">
          <span className="hero-install-label">npx</span>
          <code>@travisliu/open-dynamic-workflow --help</code>
        </div>
      </section>

      {/* Providers */}
      <section style={{ padding: "40px 20px", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 18 }}>
            Supported providers
          </p>
          <div className="provider-grid">
            {PROVIDERS.map((p) => (
              <div className="provider-chip" key={p.name}>
                <span className="provider-chip-dot" />
                {p.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="features-section">
        <div className="features-inner">
          <div className="section-header">
            <h2>Everything you need to orchestrate agents reliably</h2>
            <p>Built for teams that need stable, reviewable, and reproducible agent execution.</p>
          </div>
          <div className="card-grid">
            {FEATURES.map((f) => (
              <div className="card" key={f.title}>
                <div className={`card-icon ${f.iconClass}`}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow example */}
      <section style={{ padding: "60px 20px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div className="section-header">
            <h2>Write once, run anywhere</h2>
            <p>
              A workflow script defines agents, coordination, outputs, and failure handling in plain
              TypeScript.
            </p>
          </div>
          <CodeBlock lang="typescript">{WORKFLOW_EXAMPLE}</CodeBlock>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
            <BashBlock>npx @travisliu/open-dynamic-workflow validate workflows/parallel-pr-review.ts</BashBlock>
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
            <BashBlock>npx @travisliu/open-dynamic-workflow run parallel-pr-review --report pretty</BashBlock>
          </div>
        </div>
      </section>

      {/* Workflow Patterns */}
      <section style={{ padding: "60px 20px", background: "var(--bg-warm)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div className="section-header">
            <h2>Workflow patterns for every task</h2>
            <p>From simple single-agent tasks to complex multi-stage pipelines.</p>
          </div>
          <div className="card-grid">
            {PATTERNS.map((pat) => (
              <Link
                to="/guides"
                className="card"
                key={pat.title}
                style={{ display: "block", textDecoration: "none" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{pat.title}</h3>
                  <span className={`badge ${pat.tagClass}`}>{pat.tag}</span>
                </div>
                <p style={{ margin: 0, fontSize: 13.5 }}>{pat.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section style={{ padding: "60px 20px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="section-header">
            <h2>Start in seconds</h2>
            <p>No installation required — run directly with npx.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--blue-light)", color: "var(--blue-dark)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 6 }}>1</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>Initialize your project</p>
                <BashBlock>npx @travisliu/open-dynamic-workflow init</BashBlock>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--blue-light)", color: "var(--blue-dark)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 6 }}>2</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>Check your environment</p>
                <BashBlock>npx @travisliu/open-dynamic-workflow doctor</BashBlock>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--blue-light)", color: "var(--blue-dark)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, flexShrink: 0, marginTop: 6 }}>3</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>Validate and run your workflow</p>
                <BashBlock>npx @travisliu/open-dynamic-workflow validate workflows/example.workflow.ts</BashBlock>
                <BashBlock>npx @travisliu/open-dynamic-workflow run example --report pretty</BashBlock>
              </div>
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 40 }}>
            <Link to="/guides" className="btn-primary" style={{ marginRight: 12 }}>
              Read the full guide →
            </Link>
            <a href={NPM_URL} className="btn-secondary" target="_blank" rel="noreferrer noopener">
              View on npm
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
