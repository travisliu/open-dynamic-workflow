import { useParams } from "react-router-dom";
import DocsSidebar from "../components/DocsSidebar";
import CodeBlock, { BashBlock } from "../components/CodeBlock";

const SIDEBAR_SECTIONS = [
  {
    title: "DSL",
    items: [
      { label: "agent()", to: "/reference/agent" },
      { label: "parallel()", to: "/reference/parallel" },
      { label: "pipeline()", to: "/reference/pipeline" },
      { label: "loop()", to: "/reference/loop" },
      { label: "workflow()", to: "/reference/workflow" },
      { label: "tool()", to: "/reference/tool" },
      { label: "phase()", to: "/reference/phase" },
      { label: "log()", to: "/reference/log" },
      { label: "context", to: "/reference/context" },
    ],
  },
  {
    title: "CLI",
    items: [
      { label: "CLI Commands", to: "/reference/cli" },
      { label: "Configuration", to: "/reference/configuration" },
      { label: "Providers", to: "/reference/providers" },
      { label: "Provider Aliases", to: "/reference/provider-aliases" },
      { label: "Run Profiles", to: "/reference/profiles" },
    ],
  },
  {
    title: "Runtime",
    items: [
      { label: "Artifacts", to: "/reference/artifacts" },
      { label: "Reporting Modes", to: "/reference/reporting" },
      { label: "Retry Configuration", to: "/reference/retry" },
      { label: "Exit Codes", to: "/reference/exit-codes" },
      { label: "Security Model", to: "/reference/security" },
    ],
  },
];

// All reference entries keyed by section slug
const REFERENCE_ENTRIES: Record<string, React.FC> = {
  agent: AgentRef,
  parallel: ParallelRef,
  pipeline: PipelineRef,
  loop: LoopRef,
  workflow: WorkflowRef,
  tool: ToolRef,
  phase: PhaseRef,
  log: LogRef,
  context: ContextRef,
  cli: CliRef,
  configuration: ConfigRef,
  providers: ProvidersRef,
  "provider-aliases": ProviderAliasesRef,
  profiles: ProfilesRef,
  artifacts: ArtifactsRef,
  reporting: ReportingRef,
  retry: RetryRef,
  "exit-codes": ExitCodesRef,
  security: SecurityRef,
};

export default function ReferencePage() {
  const { section } = useParams<{ section?: string }>();
  const activeSection = section ?? "agent";
  const Content = REFERENCE_ENTRIES[activeSection] ?? AgentRef;

  return (
    <div style={{ display: "flex", paddingTop: "var(--topbar-height)" }}>
      <DocsSidebar sections={SIDEBAR_SECTIONS} />
      <main className="docs-main">
        <article className="docs-content">
          <Content />
        </article>
      </main>
    </div>
  );
}

// ===== DSL References =====

function AgentRef() {
  return (
    <>
      <h1>agent()</h1>
      <p className="lead">
        Run a single provider-backed agent task. The primary DSL primitive for calling an external
        coding-agent CLI.
      </p>

      <h2>Signature</h2>
      <div className="ref-signature">
        {`agent(options: AgentOptions): Promise<AgentResult>`}
      </div>

      <h2>Parameters</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["id", "string", "Required. Unique stable agent call identifier within the workflow."],
              ["prompt", "string", "Required. Natural-language instruction sent to the provider."],
              ["provider", "string?", "Provider name or alias. Defaults to config defaultProvider."],
              ["model", "string?", "Model override for this call."],
              ["timeoutMs", "number?", "Per-call timeout in milliseconds."],
              ["permissions", "object?", "Agent permission mode (default, dangerously-full-access)."],
              ["schema", "object?", "JSON Schema to validate structured output."],
              ["retry", "RetryConfig?", "Retry policy for this call."],
              ["phase", "string?", "Logical phase name for this call."],
              ["tags", "string[]?", "Optional tags for filtering and reporting."],
            ].map(([opt, type, desc]) => (
              <tr key={opt}>
                <td><code>{opt}</code></td>
                <td><code>{type}</code></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Return Value</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["content", "string", "Raw text output from the provider."],
              ["structured", "object?", "Validated structured output (if schema was provided)."],
              ["metadata", "object", "Provider, model, duration, tokens, and run metadata."],
              ["exitCode", "number", "Provider process exit code."],
            ].map(([field, type, desc]) => (
              <tr key={field}>
                <td><code>{field}</code></td>
                <td><code>{type}</code></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Example</h2>
      <CodeBlock lang="typescript">{`const result = await agent({
  id: "security-review",
  provider: "codex",
  prompt: "Review this change for security risks.",
  schema: {
    type: "object",
    properties: {
      findings: { type: "array" },
      severity: { type: "string" },
    },
    required: ["findings", "severity"],
  },
  retry: { maxAttempts: 2 },
});

console.log(result.content);
console.log(result.structured?.findings);`}</CodeBlock>
    </>
  );
}

function ParallelRef() {
  return (
    <>
      <h1>parallel()</h1>
      <p className="lead">
        Run multiple independent agent task thunks concurrently, respecting the global scheduler
        concurrency limit.
      </p>

      <h2>Signature</h2>
      <div className="ref-signature">
        {`parallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]>`}
      </div>

      <h2>Rules</h2>
      <ul>
        <li>Accept task thunks (functions returning promises), not already-started promises.</li>
        <li>Preserves the global scheduler concurrency limit.</li>
        <li>Does not support dependency ordering — use pipeline() for ordered per-item stages.</li>
        <li>Results are returned in the same order as the input tasks.</li>
      </ul>

      <h2>Example</h2>
      <CodeBlock lang="typescript">{`const [security, correctness] = await parallel([
  () => agent({ id: "security", provider: "codex", prompt: "Security review." }),
  () => agent({ id: "correctness", provider: "codex", prompt: "Correctness review." }),
]);`}</CodeBlock>
    </>
  );
}

function PipelineRef() {
  return (
    <>
      <h1>pipeline()</h1>
      <p className="lead">
        Process many items through the same ordered sequence of named stages. Each item passes
        through each stage in order.
      </p>

      <h2>Signature</h2>
      <div className="ref-signature">
        {`pipeline(options: PipelineOptions): Promise<PipelineResult>`}
      </div>

      <h2>Options</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["items", "T[]", "Array of items to process."],
              ["stages", "Stage[]", "Ordered array of named stage definitions."],
              ["strategy", '"item-streaming" | "stage-by-stage"', "Execution strategy."],
              ["concurrency", "number?", "Max parallel items (default: global concurrency)."],
              ["failFast", "boolean?", "Stop all items on first failure (default: false)."],
            ].map(([opt, type, desc]) => (
              <tr key={opt}>
                <td><code>{opt}</code></td>
                <td><code>{type}</code></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Stage Definition</h2>
      <CodeBlock lang="typescript">{`{
  name: string;
  run: (ctx: PipelineStageContext, item: T, prevResult?: AgentResult) => Promise<AgentResult>;
}`}</CodeBlock>

      <h2>Rules</h2>
      <ul>
        <li>Agent calls inside stages must use <code>ctx.agent()</code>.</li>
        <li>The scheduler still owns agent lifecycle, timeout, cancellation, and concurrency.</li>
        <li>Pipeline must not grant shell, filesystem, or import permissions.</li>
        <li>Input order is preserved in results.</li>
      </ul>
    </>
  );
}

function LoopRef() {
  return (
    <>
      <h1>loop()</h1>
      <p className="lead">
        Repeat a stateful round callback until a terminal condition is returned or maxRounds is
        reached.
      </p>

      <h2>Signature</h2>
      <div className="ref-signature">
        {`loop<S>(options: LoopOptions<S>): Promise<LoopResult<S>>`}
      </div>

      <h2>Options</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["maxRounds", "number", "Required. Maximum rounds before the loop terminates."],
              ["initialState", "S", "Initial state passed to the first round callback."],
              ["round", "(ctx, state: S) => Promise<RoundResult<S>>", "Round callback returning {done, nextState}."],
            ].map(([opt, type, desc]) => (
              <tr key={opt}>
                <td><code>{opt}</code></td>
                <td><code style={{ fontSize: "11px" }}>{type}</code></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>RoundResult</h2>
      <CodeBlock lang="typescript">{`{ done: true;  nextState: S }  // terminal: stops the loop
{ done: false; nextState: S }  // continues to next round`}</CodeBlock>
    </>
  );
}

function WorkflowRef() {
  return (
    <>
      <h1>workflow()</h1>
      <p className="lead">
        Invoke another workflow file as a child of the current run, sharing the same context store
        and run artifact directory.
      </p>

      <h2>Signature</h2>
      <div className="ref-signature">
        {`workflow(nameOrPath: string, options?: WorkflowOptions): Promise<WorkflowResult>`}
      </div>

      <h2>Options</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["args", "JSON-safe arguments passed to the child workflow."],
              ["failureMode", '"throw" | "settled" — whether a child failure throws or is collected.'],
            ].map(([opt, desc]) => (
              <tr key={opt}>
                <td><code>{opt}</code></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ToolRef() {
  return (
    <>
      <h1>tool()</h1>
      <p className="lead">
        Run a registered deterministic tool definition. Tools load or compute data before passing it
        to agents.
      </p>

      <h2>Signature</h2>
      <div className="ref-signature">
        {`tool(name: string, args?: JsonObject): Promise<JsonValue>`}
      </div>

      <h2>Constraints</h2>
      <ul>
        <li>Call <code>tool()</code> at the workflow top level only.</li>
        <li>Do not place <code>tool()</code> inside <code>parallel()</code> or <code>pipeline()</code> stage callbacks.</li>
        <li>Tools must be registered in <code>.open-dynamic-workflow/tools/</code>.</li>
      </ul>

      <h2>Example</h2>
      <CodeBlock lang="typescript">{`const data = await tool("read-json", { path: "input.json" });
// data is a JSON value from the registered tool`}</CodeBlock>
    </>
  );
}

function PhaseRef() {
  return (
    <>
      <h1>phase()</h1>
      <p className="lead">
        Mark the current workflow phase. Phases appear in run events, artifacts, and pretty reports.
      </p>

      <h2>Signature</h2>
      <div className="ref-signature">{`phase(name: string): void`}</div>

      <h2>Usage</h2>
      <p>
        Call <code>phase()</code> before a group of related agent calls to organize your workflow
        into logical sections. Phase names must match the <code>meta.phases</code> array if
        provided.
      </p>
      <CodeBlock lang="typescript">{`phase("review");
const result = await agent({ id: "review", prompt: "..." });

phase("summarize");
const summary = await agent({ id: "summary", prompt: "..." });`}</CodeBlock>
    </>
  );
}

function LogRef() {
  return (
    <>
      <h1>log()</h1>
      <p className="lead">
        Emit a workflow log event. Log events appear in pretty output and the run event log.
      </p>

      <h2>Signature</h2>
      <div className="ref-signature">{`log(message: string, data?: JsonObject): void`}</div>

      <h2>Example</h2>
      <CodeBlock lang="typescript">{`log("Starting analysis", { files: ["src/auth.ts"] });
const result = await agent({ id: "analyze", prompt: "..." });
log("Analysis complete", { tokens: result.metadata.tokens });`}</CodeBlock>
    </>
  );
}

function ContextRef() {
  return (
    <>
      <h1>context</h1>
      <p className="lead">
        A JSON-safe, run-scoped global key-path store available throughout the entire workflow run.
      </p>

      <h2>API</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["context.get<T>(path)", "Deep clone of value at path, or undefined."],
              ["context.set(path, value)", "Set value at path, creating intermediate objects."],
              ["context.has(path)", "Returns true if path exists (even if value is null)."],
              ["context.delete(path)", "Delete the property at path."],
              ["context.append(path, value)", "Append to array at path (creates array if missing)."],
              ["context.merge(path, obj)", "Shallow merge plain object into target at path."],
              ["context.snapshot()", "Deep-clone snapshot of the entire context."],
              ["context.scope(prefix, fn)", "Run fn with path prefix applied to all operations."],
            ].map(([method, desc]) => (
              <tr key={method}>
                <td><code style={{ fontSize: "12px" }}>{method}</code></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Path Rules</h2>
      <ul>
        <li>Dot-separated paths: <code>"features.plan.goal"</code></li>
        <li>Whitespace in segments is trimmed; empty segments are rejected.</li>
        <li>Leading/trailing dots are rejected.</li>
        <li>Reserved names (<code>__proto__</code>, <code>prototype</code>, <code>constructor</code>) are rejected.</li>
        <li>Purely numeric segments are rejected (no array indexing).</li>
      </ul>

      <div className="callout warning">
        <span className="callout-icon">⚠</span>
        <div className="callout-body">
          <strong>ctx.context is unsupported</strong>
          <p>
            The callback parameter <code>ctx</code> inside pipeline stages or loop rounds does not
            expose <code>ctx.context</code>. Always use the global <code>context</code> binding.
          </p>
        </div>
      </div>
    </>
  );
}

// ===== CLI References =====

function CliRef() {
  return (
    <>
      <h1>CLI Commands</h1>
      <p className="lead">
        Open Dynamic Workflow provides a CLI under the names <code>open-dynamic-workflow</code> and{" "}
        <code>odw</code>.
      </p>

      <h2>init</h2>
      <p>Initialize a project with the standard directory structure and config.</p>
      <BashBlock>open-dynamic-workflow init [options]</BashBlock>
      <div className="table-container">
        <table>
          <thead><tr><th>Flag</th><th>Description</th></tr></thead>
          <tbody>
            {[
              ["--yes", "Non-interactive with defaults"],
              ["--provider <name>", "Default provider"],
              ["--force", "Overwrite existing files"],
              ["--strict", "Fail if any target already exists"],
              ["--run-smoke-test", "Validate and run example with mock"],
              ["--report <pretty|json>", "Smoke test report mode"],
            ].map(([f, d]) => <tr key={f}><td><code>{f}</code></td><td>{d}</td></tr>)}
          </tbody>
        </table>
      </div>

      <h2>run</h2>
      <p>Run a workflow by name or file path.</p>
      <BashBlock>{"open-dynamic-workflow run <workflow-name-or-file> [options]"}</BashBlock>
      <div className="table-container">
        <table>
          <thead><tr><th>Flag</th><th>Description</th></tr></thead>
          <tbody>
            {[
              ["--provider <name>", "Override default provider"],
              ["--model <name>", "Override default model"],
              ["--concurrency <num>", "Max parallel agent calls"],
              ["--timeout-ms <num>", "Workflow execution timeout"],
              ["--report <pretty|json|jsonl>", "Output format"],
              ["--fail-fast", "Abort on first failure"],
              ["--resume <run-id>", "Resume a previous run"],
              ["--profile <name>", "Select a run profile"],
              ["--max-agent-calls <num>", "Limit total live provider calls"],
            ].map(([f, d]) => <tr key={f}><td><code>{f}</code></td><td>{d}</td></tr>)}
          </tbody>
        </table>
      </div>

      <h2>validate</h2>
      <p>Validate a workflow file without running providers.</p>
      <BashBlock>{"open-dynamic-workflow validate <file>"}</BashBlock>

      <h2>doctor</h2>
      <p>Check environment, provider CLIs, and configuration.</p>
      <BashBlock>open-dynamic-workflow doctor</BashBlock>

      <h2>list</h2>
      <p>List discoverable workflows, shared agents, and tools.</p>
      <BashBlock>open-dynamic-workflow list [workflows|agents|tools]</BashBlock>

      <h2>resume</h2>
      <p>Resume a specific previous run by its run ID.</p>
      <BashBlock>{"open-dynamic-workflow resume <run-id>"}</BashBlock>
    </>
  );
}

function ConfigRef() {
  return (
    <>
      <h1>Configuration</h1>
      <p className="lead">
        Open Dynamic Workflow loads configuration from{" "}
        <code>.open-dynamic-workflow/config.yaml</code> by default.
      </p>

      <h2>Example Config</h2>
      <CodeBlock lang="yaml">{`defaultProvider: codex
concurrency: 4
timeoutMs: 900000
maxAgentCalls: 20

providers:
  codex:
    command: codex
    args:
      - exec
      - --json
      - --ephemeral
    defaultModel: null

  gemini:
    command: gemini
    args:
      - --output-format
      - json
    defaultModel: gemini-3-flash-preview

providerAliases:
  fast-review:
    provider: gemini
    model: gemini-3-flash-preview
    timeoutMs: 300000
    retry:
      maxAttempts: 2

security:
  passEnv: []
  redactEnv:
    - OPENAI_API_KEY
    - GEMINI_API_KEY
    - GOOGLE_API_KEY
    - '*_TOKEN'
    - '*_SECRET'`}</CodeBlock>

      <h2>Precedence (highest first)</h2>
      <ol>
        <li>Explicit <code>agent()</code> values</li>
        <li>Selected provider alias values</li>
        <li>CLI run-level defaults (<code>--provider</code>, <code>--model</code>, <code>--timeout-ms</code>)</li>
        <li>Concrete provider configuration</li>
        <li>Global configuration</li>
        <li>Built-in defaults</li>
      </ol>
    </>
  );
}

function ProvidersRef() {
  return (
    <>
      <h1>Providers</h1>
      <p className="lead">
        Open Dynamic Workflow orchestrates external provider CLIs through adapters. It does not
        implement its own coding agent.
      </p>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>CLI</th>
              <th>dangerously-full-access behavior</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["mock", "Built-in mock", "Accepted without changing deterministic behavior"],
              ["codex", "Codex CLI", "--dangerously-bypass-approvals-and-sandbox"],
              ["gemini", "Gemini CLI", "--approval-mode yolo (default: plan)"],
              ["copilot", "GitHub Copilot CLI", "--yolo"],
              ["opencode", "OpenCode CLI", "--dangerously-skip-permissions"],
              ["antigravity", "Antigravity CLI", "--dangerously-skip-permissions"],
              ["pi", "Pi Coding Agent", "Switches to configured fullAccessTools"],
              ["cursor", "Cursor Agent CLI", "--force (configurable)"],
            ].map(([p, cli, dfa]) => (
              <tr key={p}>
                <td><code>{p}</code></td>
                <td><code>{cli}</code></td>
                <td style={{ fontSize: "12.5px" }}>{dfa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="callout warning">
        <span className="callout-icon">⚠</span>
        <div className="callout-body">
          <strong>dangerously-full-access is not a sandbox</strong>
          <p>
            This mode grants full permission mapping to the provider CLI, bypassing safety
            boundaries in the provider context. Use with care.
          </p>
        </div>
      </div>
    </>
  );
}

function ProviderAliasesRef() {
  return (
    <>
      <h1>Provider Aliases</h1>
      <p className="lead">
        Reusable execution presets that bundle provider, model, timeout, and retry settings under a
        single name.
      </p>

      <h2>Configuration</h2>
      <CodeBlock lang="yaml">{`providerAliases:
  fast-review:
    provider: gemini
    model: gemini-3-flash-preview
    timeoutMs: 300000
    retry:
      maxAttempts: 2

  deep-analysis:
    provider: codex
    timeoutMs: 1800000
    retry:
      maxAttempts: 3`}</CodeBlock>

      <h2>Rules</h2>
      <ul>
        <li>An alias may define only: <code>provider</code>, <code>extends</code>, <code>model</code>, <code>thinkingEffort</code>, <code>timeoutMs</code>, <code>retry</code>.</li>
        <li>Aliases cannot contain permissions, environment, command, or argument settings.</li>
        <li>One parent at most (<code>extends</code> takes a single name).</li>
        <li>Aliases share the namespace with concrete providers.</li>
        <li>Alias selection is recorded in <code>providerSelection</code> metadata.</li>
        <li>Changing an alias invalidates the affected cache prefix.</li>
      </ul>

      <h2>Usage</h2>
      <CodeBlock lang="typescript">{`// Use alias name in agent() provider field
const result = await agent({
  id: "fast-check",
  provider: "fast-review",
  prompt: "Quick check for obvious issues.",
});`}</CodeBlock>
    </>
  );
}

function ProfilesRef() {
  return (
    <>
      <h1>Run Profiles</h1>
      <p className="lead">
        Bundle reusable execution parameters under a named profile — args, context, and runner
        options — for consistent and reproducible runs.
      </p>

      <h2>Configuration</h2>
      <CodeBlock lang="yaml">{`profiles:
  base:
    args:
      iterations: 3
    context:
      mode: "normal"
      quality: { level: "standard" }
    run:
      provider: "mock"
      concurrency: 2

  fast:
    extends: base
    args:
      iterations: 1
    context:
      mode: "fast"`}</CodeBlock>

      <h2>Usage</h2>
      <BashBlock>odw run workflows/my-workflow.ts --profile fast</BashBlock>
      <p>Load from an external profile catalog:</p>
      <BashBlock>odw run workflows/my-workflow.ts --profiles profiles.yaml --profile fast</BashBlock>

      <h2>Precedence (highest to lowest)</h2>
      <ol>
        <li>Explicit <code>--arg</code> values</li>
        <li>Explicit CLI run flags (<code>--concurrency</code>, <code>--timeout-ms</code>)</li>
        <li>Selected resolved profile</li>
        <li>Active project configuration</li>
        <li>Built-in defaults</li>
      </ol>

      <div className="callout warning">
        <span className="callout-icon">⚠</span>
        <div className="callout-body">
          <strong>run-input.json is sensitive</strong>
          <p>
            The full resolved profile snapshot is written to <code>run-input.json</code> in the run
            artifacts directory. Handle securely — it may contain actual input arguments and context
            values.
          </p>
        </div>
      </div>
    </>
  );
}

function ArtifactsRef() {
  return (
    <>
      <h1>Artifacts</h1>
      <p className="lead">
        Every workflow run creates a local artifact directory. Artifacts are always enabled so
        failed or partial runs remain debuggable.
      </p>

      <h2>Directory Structure</h2>
      <CodeBlock lang="bash">{`.openflow/runs/<runId>/
  manifest.json
  workflow.input.ts
  config.resolved.json
  run-input.json
  calls.jsonl
  cache-index.json
  events.jsonl
  report.json
  agents/
    <agentId>/
      prompt.txt
      stdout.log
      stderr.log
      raw-result.json
      normalized-result.json
      schema.json
      validation-error.json
      permissions.json
      metadata.json
  workflows/
    <workflowInvocationId>/
      input.json
      result.json
      error.json
      summary.json`}</CodeBlock>

      <div className="callout warning">
        <span className="callout-icon">⚠</span>
        <div className="callout-body">
          <strong>Artifacts may be sensitive</strong>
          <p>
            Artifacts may contain prompts, source snippets, stdout, stderr, and model outputs. Be
            careful before sharing run artifact directories.
          </p>
        </div>
      </div>
    </>
  );
}

function ReportingRef() {
  return (
    <>
      <h1>Reporting Modes</h1>
      <p className="lead">
        Control output format with the <code>--report</code> flag.
      </p>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Mode</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["pretty", "Human-readable colored output. Default for interactive terminals."],
              ["json", "Prints only the final machine-readable report JSON."],
              ["jsonl", "Line-delimited JSON events streamed as the run progresses."],
            ].map(([mode, desc]) => (
              <tr key={mode}>
                <td><code>{mode}</code></td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Example</h2>
      <BashBlock>open-dynamic-workflow run my-workflow --report pretty</BashBlock>
      <BashBlock>{"open-dynamic-workflow run my-workflow --report json > report.json"}</BashBlock>
      <BashBlock>open-dynamic-workflow run my-workflow --report jsonl | jq .</BashBlock>

      <div className="callout info">
        <span className="callout-icon">ℹ</span>
        <div className="callout-body">
          <strong>JSONL format</strong>
          <p>
            JSONL output is machine-readable and stays line-delimited. Unknown event types are safe
            to ignore. Reporters do not affect execution semantics.
          </p>
        </div>
      </div>
    </>
  );
}

function RetryRef() {
  return (
    <>
      <h1>Retry Configuration</h1>
      <p className="lead">
        Configure automatic retries for provider agent calls.
      </p>

      <h2>Config-Level Retry</h2>
      <CodeBlock lang="yaml">{`providers:
  codex:
    retry:
      maxAttempts: 3
      backoffMs: 1000
      backoffMultiplier: 2`}</CodeBlock>

      <h2>Per-Call Retry</h2>
      <CodeBlock lang="typescript">{`const result = await agent({
  id: "retry-example",
  prompt: "...",
  retry: {
    maxAttempts: 2,
    backoffMs: 500,
  },
});`}</CodeBlock>

      <h2>Disabling Retry</h2>
      <CodeBlock lang="typescript">{`// Explicit false disables inherited retry policy
const result = await agent({
  id: "no-retry",
  prompt: "...",
  retry: false,
});`}</CodeBlock>

      <h2>CLI Override</h2>
      <BashBlock>open-dynamic-workflow run my-workflow --retry-max-attempts 2</BashBlock>
    </>
  );
}

function ExitCodesRef() {
  return (
    <>
      <h1>Exit Codes</h1>
      <p className="lead">
        Open Dynamic Workflow uses standard exit codes so CI pipelines can respond to specific
        failure modes.
      </p>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["0", "Success — workflow completed without errors."],
              ["1", "Workflow failure — one or more agent calls failed."],
              ["2", "Validation failure — workflow file has DSL or syntax errors."],
              ["3", "Configuration error — config.yaml is missing or invalid."],
              ["4", "Provider error — the requested provider CLI was not found or failed to start."],
              ["5", "Timeout — the workflow exceeded the configured timeout."],
              ["130", "Interrupted — the process received SIGINT (Ctrl+C)."],
            ].map(([code, meaning]) => (
              <tr key={code}>
                <td><code>{code}</code></td>
                <td>{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SecurityRef() {
  return (
    <>
      <h1>Security Model</h1>
      <p className="lead">
        Open Dynamic Workflow takes a conservative, allowlist-based approach to security.
      </p>

      <h2>Workflow Runtime Constraints</h2>
      <p>Workflow code runs in a constrained environment. The runtime rejects:</p>
      <ul>
        <li>Arbitrary <code>import</code> statements</li>
        <li><code>require()</code> calls</li>
        <li>Direct filesystem APIs</li>
        <li>Direct process APIs and shell execution</li>
        <li>Unsupported globals</li>
        <li>Direct access to adapters, event bus, artifact store, or process runner</li>
      </ul>

      <div className="callout info">
        <span className="callout-icon">ℹ</span>
        <div className="callout-body">
          <strong>Not a complete sandbox</strong>
          <p>
            The constrained runtime reduces accidental misuse but is not a complete sandbox for
            malicious code.
          </p>
        </div>
      </div>

      <h2>Environment Variables</h2>
      <CodeBlock lang="yaml">{`security:
  passEnv: []           # Allowlist of env vars to pass to providers
  redactEnv:
    - OPENAI_API_KEY
    - GEMINI_API_KEY
    - '*_TOKEN'
    - '*_SECRET'`}</CodeBlock>

      <h2>Secret Redaction</h2>
      <p>Secrets are redacted before logs, events, reports, previews, and serialized errors.</p>

      <h2>Artifact Sensitivity</h2>
      <p>
        Treat all artifacts as potentially sensitive — they may contain prompts, source snippets,
        stdout, stderr, and model outputs.
      </p>

      <h2>Permissions</h2>
      <p>
        Workflows that omit the <code>permissions</code> field default to{" "}
        <code>{"{ mode: 'default' }"}</code>, which does not pass write-enabling flags to the
        provider.
      </p>
    </>
  );
}
