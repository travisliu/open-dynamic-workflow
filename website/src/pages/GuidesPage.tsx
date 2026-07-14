import { useEffect } from "react";
import { useParams } from "react-router-dom";
import DocsSidebar from "../components/DocsSidebar";
import CodeBlock, { BashBlock } from "../components/CodeBlock";

const SIDEBAR_SECTIONS = [
  {
    title: "Getting Started",
    items: [
      { label: "Requirements", to: "/guides/requirements" },
      { label: "Quick Start with npx", to: "/guides/quickstart" },
      { label: "Initialize a Project", to: "/guides/init" },
      { label: "Environment Check", to: "/guides/doctor" },
      { label: "Validate & Run", to: "/guides/run" },
    ],
  },
  {
    title: "Workflow Patterns",
    items: [
      { label: "Single Agent", to: "/guides/single-agent" },
      { label: "Parallel Workflows", to: "/guides/parallel" },
      { label: "Pipeline", to: "/guides/pipeline" },
      { label: "Fan-out / Fan-in", to: "/guides/fanout" },
      { label: "Goal-Oriented Loop", to: "/guides/loop" },
      { label: "Tool-Assisted", to: "/guides/tools" },
      { label: "Child Workflows", to: "/guides/child-workflows" },
      { label: "Global Context", to: "/guides/context" },
    ],
  },
];

const SINGLE_AGENT_EXAMPLE = `import { agent, phase } from "@travisliu/open-dynamic-workflow";

export const meta = {
  name: "single-review",
  description: "Review the project for correctness and security",
  phases: ["review"],
};

export default async function () {
  phase("review");

  const result = await agent({
    id: "review",
    provider: "codex",
    prompt: "Review this project for correctness, security, and maintainability.",
  });

  return { result };
}`;

const PARALLEL_EXAMPLE = `import { agent, parallel } from "@travisliu/open-dynamic-workflow";

export const meta = {
  name: "parallel-review",
  description: "Run multiple reviews in parallel",
};

export default async function () {
  const [correctness, security, tests] = await parallel([
    () => agent({
      id: "correctness-review",
      provider: "codex",
      prompt: "Review for correctness.",
    }),
    () => agent({
      id: "security-review",
      provider: "codex",
      prompt: "Review for security risks.",
    }),
    () => agent({
      id: "test-review",
      provider: "gemini",
      prompt: "Review test coverage and edge cases.",
    }),
  ]);

  return { correctness, security, tests };
}`;

const PIPELINE_EXAMPLE = `import { pipeline } from "@travisliu/open-dynamic-workflow";

export const meta = {
  name: "file-pipeline",
  description: "Process multiple files through analysis stages",
};

export default async function () {
  const result = await pipeline({
    items: ["src/auth.ts", "src/billing.ts", "src/api.ts"],
    strategy: "item-streaming",
    concurrency: 3,
    failFast: false,
    stages: [
      {
        name: "analyze",
        run: async (ctx, file) => {
          return ctx.agent({
            id: "analyze",
            provider: "codex",
            prompt: \`Analyze \${file} for issues.\`,
          });
        },
      },
      {
        name: "plan",
        run: async (ctx, file, prev) => {
          return ctx.agent({
            id: "plan",
            provider: "gemini",
            prompt: \`Create a remediation plan for \${file}. Findings: \${prev.content}\`,
          });
        },
      },
    ],
  });

  return result;
}`;

const LOOP_EXAMPLE = `import { loop } from "@travisliu/open-dynamic-workflow";

export const meta = {
  name: "loop-review",
  description: "Review and fix code in a goal-oriented loop",
};

export default async function () {
  const result = await loop({
    maxRounds: 5,
    initialState: { file: "src/auth.ts", round: 0 },
    round: async (ctx, state) => {
      const review = await ctx.agent({
        id: "review",
        provider: "codex",
        prompt: \`Round \${state.round}: Review \${state.file} for remaining issues.\`,
      });

      if (review.content.includes("no issues")) {
        return { done: true, nextState: { ...state, status: "clean" } };
      }

      await ctx.agent({
        id: "fix",
        provider: "gemini",
        prompt: \`Fix these issues in \${state.file}: \${review.content}\`,
      });

      return { done: false, nextState: { ...state, round: state.round + 1 } };
    },
  });

  return result;
}`;

const CONTEXT_EXAMPLE = `import { agent, context } from "@travisliu/open-dynamic-workflow";

export const meta = {
  name: "context-example",
  description: "Using the global context store",
};

export default async function () {
  // Set initial state
  context.set("status", "initialized");
  context.set("config.mode", "review");

  const result = await agent({
    id: "run-step",
    prompt: \`Analyze project files. Status: \${context.get("status")}\`,
  });

  context.set("analysis.output", result.content);
  context.append("history", { step: "analysis", at: Date.now() });

  return {
    status: context.get("status"),
    snapshot: context.snapshot(),
  };
}`;

export default function GuidesPage() {
  const { section } = useParams<{ section?: string }>();

  useEffect(() => {
    if (section) {
      const el = document.getElementById(section);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [section]);
  return (
    <div style={{ display: "flex", paddingTop: "var(--topbar-height)" }}>
      <DocsSidebar sections={SIDEBAR_SECTIONS} />

      <main className="docs-main">
        <article className="docs-content">
          <h1>Guides</h1>
          <p className="lead">
            Everything you need to start writing and running Open Dynamic Workflow scripts — from
            setup to advanced patterns.
          </p>

          {/* Requirements */}
          <section id="requirements">
            <h2>Requirements</h2>
            <p>
              Open Dynamic Workflow runs as a CLI tool. No global installation is required — you
              can use <code>npx</code> to run it directly.
            </p>
            <ul>
              <li>Node.js 20 or newer</li>
              <li>
                At least one supported provider CLI installed and accessible in your{" "}
                <code>PATH</code> (or use the built-in <code>mock</code> provider for dry runs)
              </li>
            </ul>
          </section>

          {/* Quick Start */}
          <section id="quickstart">
            <h2>Quick Start with npx</h2>
            <p>Run Open Dynamic Workflow directly without installing it globally:</p>
            <BashBlock>npx @travisliu/open-dynamic-workflow --help</BashBlock>
            <p>
              You can also use the <code>odw</code> alias if you have it installed locally:
            </p>
            <BashBlock>odw --help</BashBlock>
          </section>

          {/* Init */}
          <section id="init">
            <h2>Initialize a Project</h2>
            <p>
              Create the standard Open Dynamic Workflow project structure in your repository:
            </p>
            <BashBlock>npx @travisliu/open-dynamic-workflow init</BashBlock>
            <p>This creates:</p>
            <ul>
              <li>
                <code>.open-dynamic-workflow/config.yaml</code> — core project configuration
              </li>
              <li>
                <code>.open-dynamic-workflow/agents/</code> — shared agents directory
              </li>
              <li>
                <code>.open-dynamic-workflow/tools/</code> — tools directory with a starter example
              </li>
              <li>
                <code>workflows/example.workflow.ts</code> — starter workflow template
              </li>
            </ul>
            <p>Common options:</p>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Flag</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["--yes", "Non-interactive mode with defaults"],
                    ["--provider <name>", "Default provider for generated config"],
                    ["--force", "Overwrite existing generated files"],
                    ["--run-smoke-test", "Validate and run the example with mock"],
                  ].map(([flag, desc]) => (
                    <tr key={flag}>
                      <td>
                        <code>{flag}</code>
                      </td>
                      <td>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Doctor */}
          <section id="doctor">
            <h2>Environment Check</h2>
            <p>
              Run <code>doctor</code> to verify your environment is ready:
            </p>
            <BashBlock>npx @travisliu/open-dynamic-workflow doctor</BashBlock>
            <p>
              This checks that Node.js, provider CLIs, and configuration are correctly set up.
            </p>
          </section>

          {/* Run */}
          <section id="run">
            <h2>List, Validate, and Run</h2>
            <p>List discoverable workflows, shared agents, and tools:</p>
            <BashBlock>npx @travisliu/open-dynamic-workflow list</BashBlock>
            <p>Validate a workflow before running providers:</p>
            <BashBlock>
              npx @travisliu/open-dynamic-workflow validate workflows/example.workflow.ts
            </BashBlock>
            <p>Run a workflow:</p>
            <BashBlock>
              npx @travisliu/open-dynamic-workflow run example --report pretty
            </BashBlock>
            <p>Run with a specific provider (overrides config default):</p>
            <BashBlock>
              npx @travisliu/open-dynamic-workflow run example --provider mock --report json
            </BashBlock>
          </section>

          {/* Single Agent */}
          <section id="single-agent">
            <h2>Single Agent Workflow</h2>
            <p>
              Use a single <code>agent()</code> call when one provider can complete the task.
            </p>
            <CodeBlock lang="typescript">{SINGLE_AGENT_EXAMPLE}</CodeBlock>
          </section>

          {/* Parallel */}
          <section id="parallel">
            <h2>Parallel Workflows</h2>
            <p>
              Use <code>parallel()</code> to run multiple independent agent tasks at the same time.
              Pass task thunks (functions returning promises), not already-started promises.
            </p>
            <div className="callout info">
              <span className="callout-icon">ℹ</span>
              <div className="callout-body">
                <strong>Concurrency limit</strong>
                <p>
                  parallel() respects the global scheduler concurrency limit set in your config or
                  via <code>--concurrency</code>.
                </p>
              </div>
            </div>
            <CodeBlock lang="typescript">{PARALLEL_EXAMPLE}</CodeBlock>
          </section>

          {/* Pipeline */}
          <section id="pipeline">
            <h2>Pipeline Workflow</h2>
            <p>
              Use <code>pipeline()</code> when multiple items need to pass through the same ordered
              stages. Pipeline owns item/stage progression; the scheduler still manages agent
              lifecycle.
            </p>
            <CodeBlock lang="typescript">{PIPELINE_EXAMPLE}</CodeBlock>
            <div className="table-container" style={{ marginTop: 20 }}>
              <table>
                <thead>
                  <tr>
                    <th>Option</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["strategy", '"item-streaming" | "stage-by-stage"'],
                    ["concurrency", "Max parallel items per stage"],
                    ["failFast", "Stop on first item failure (default: false)"],
                    ["stages", "Array of named stage definitions"],
                  ].map(([opt, desc]) => (
                    <tr key={opt}>
                      <td>
                        <code>{opt}</code>
                      </td>
                      <td>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Fan-out / Fan-in */}
          <section id="fanout">
            <h2>Fan-out / Fan-in</h2>
            <p>
              Run multiple branches in parallel, then use a final <code>agent()</code> to aggregate
              and summarize the results.
            </p>
            <div className="callout tip">
              <span className="callout-icon">💡</span>
              <div className="callout-body">
                <strong>Pattern</strong>
                <p>
                  Use <code>parallel()</code> for the fan-out and a final <code>agent()</code> for
                  the fan-in summary step. Keep the summarizer prompt focused on aggregation.
                </p>
              </div>
            </div>
            <CodeBlock lang="typescript">{`import { agent, parallel, phase } from "@travisliu/open-dynamic-workflow";

export const meta = { name: "fan-out", description: "Fan-out review with fan-in summary" };

export default async function () {
  phase("review");
  const [security, tests] = await parallel([
    () => agent({ id: "security", provider: "codex", prompt: "Security review." }),
    () => agent({ id: "tests", provider: "gemini", prompt: "Test coverage review." }),
  ]);

  phase("summarize");
  const summary = await agent({
    id: "summary",
    provider: "gemini",
    prompt: \`Deduplicate and summarize:\\n\${security.content}\\n\${tests.content}\`,
  });

  return { security, tests, summary };
}`}</CodeBlock>
          </section>

          {/* Loop */}
          <section id="loop">
            <h2>Goal-Oriented Loop</h2>
            <p>
              Use <code>loop()</code> when repeated, stateful execution should run until a specific
              goal or condition is satisfied — for example, a review-fix-verify cycle.
            </p>
            <CodeBlock lang="typescript">{LOOP_EXAMPLE}</CodeBlock>
            <div className="callout warning">
              <span className="callout-icon">⚠</span>
              <div className="callout-body">
                <strong>maxRounds is required</strong>
                <p>
                  Always set <code>maxRounds</code> to prevent infinite loops in case the terminal
                  condition is never met.
                </p>
              </div>
            </div>
          </section>

          {/* Tools */}
          <section id="tools">
            <h2>Tool-Assisted Workflows</h2>
            <p>
              Use <code>tool()</code> to load or compute local data through a registered
              deterministic tool before passing it to an agent.
            </p>
            <div className="callout info">
              <span className="callout-icon">ℹ</span>
              <div className="callout-body">
                <strong>Constraint</strong>
                <p>
                  Keep <code>tool()</code> calls at the workflow top level. Do not place them inside{" "}
                  <code>parallel()</code> or <code>pipeline()</code> stage callbacks.
                </p>
              </div>
            </div>
            <CodeBlock lang="typescript">{`import { agent, tool } from "@travisliu/open-dynamic-workflow";

export const meta = { name: "tool-assisted", description: "Load data then analyze" };

export default async function () {
  const data = await tool("read-json", { path: "input.json" });

  const result = await agent({
    id: "analyze",
    provider: "codex",
    prompt: \`Analyze for anomalies and correctness:\\n\${JSON.stringify(data)}\`,
  });

  return { data, result };
}`}</CodeBlock>
          </section>

          {/* Child Workflows */}
          <section id="child-workflows">
            <h2>Child Workflow Composition</h2>
            <p>
              Use <code>workflow()</code> to invoke another workflow file as a child. The parent
              collects child results and can compose them further.
            </p>
            <CodeBlock lang="typescript">{`import { agent, workflow } from "@travisliu/open-dynamic-workflow";

export const meta = { name: "parent-workflow", description: "Compose child workflows" };

export default async function () {
  const results = await Promise.allSettled([
    workflow("security-review", { args: { file: "src/auth.ts" } }),
    workflow("security-review", { args: { file: "src/billing.ts" } }),
  ]);

  const summary = await agent({
    id: "summarize",
    provider: "gemini",
    prompt: \`Summarize child results: \${JSON.stringify(results)}\`,
  });

  return { results, summary };
}`}</CodeBlock>
          </section>

          {/* Context */}
          <section id="context">
            <h2>Global Workflow Context</h2>
            <p>
              Each workflow run has a single JSON-safe global <code>context</code> store. It is
              accessible from top-level code, default-exported functions, pipeline stages, loop
              rounds, and child workflows.
            </p>
            <CodeBlock lang="typescript">{CONTEXT_EXAMPLE}</CodeBlock>
            <div className="table-container" style={{ marginTop: 20 }}>
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["context.get(path)", "Get a deep clone of the value at path"],
                    ["context.set(path, value)", "Set the value at path"],
                    ["context.has(path)", "Check if path exists"],
                    ["context.delete(path)", "Delete a property"],
                    ["context.append(path, value)", "Append to an array at path"],
                    ["context.merge(path, obj)", "Shallow merge an object at path"],
                    ["context.snapshot()", "Get a full deep-clone of the context"],
                  ].map(([method, desc]) => (
                    <tr key={method}>
                      <td>
                        <code>{method}</code>
                      </td>
                      <td>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="callout warning">
              <span className="callout-icon">⚠</span>
              <div className="callout-body">
                <strong>ctx.context is not supported</strong>
                <p>
                  The callback parameter <code>ctx</code> inside stages or rounds does not expose{" "}
                  <code>ctx.context</code>. Always use the global <code>context</code> binding
                  directly.
                </p>
              </div>
            </div>
          </section>
        </article>
      </main>
    </div>
  );
}
