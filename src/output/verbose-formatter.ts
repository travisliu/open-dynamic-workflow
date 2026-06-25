import type {
  AgentVerboseCommandPayload,
  AgentVerboseResultPayload,
  EventEnvelope,
  LoopStartedPayload,
  LoopRoundTerminalPayload,
  LoopTerminalPayload,
} from "./events.js";

export function indentBlock(text: string, spaces: number = 2): string {
  const indentation = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? indentation + line : ""))
    .join("\n");
}

export function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatDuration(ms?: number): string {
  if (typeof ms !== "number") return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatVerboseCommand(payload: AgentVerboseCommandPayload, sequence?: number, timestamp?: string): string {
  const label = payload.label ?? payload.agentId;
  const lines: string[] = [];

  lines.push(`Agent command: ${label}`);
  if (sequence !== undefined && timestamp !== undefined) {
    lines.push(`  Event: #${sequence} ${timestamp}`);
  }
  lines.push(`  Provider: ${payload.provider}${payload.model ? `/${payload.model}` : ""}`);
  lines.push(`  CWD: ${payload.cwd}`);
  if (payload.thinkingEffort) {
    lines.push(`  Thinking effort: ${payload.thinkingEffort}`);
  }

  if (payload.command) {
    const cmd = payload.command;
    const fullCmd = [cmd.command, ...cmd.args].join(" ");
    lines.push(`  Command:`);
    lines.push(indentBlock(fullCmd, 4));

    if (cmd.env && Object.keys(cmd.env).length > 0) {
      lines.push(`  Command Environment:`);
      lines.push(indentBlock(formatJson(cmd.env), 4));
    }
  } else {
    lines.push(`  Command: (unavailable)`);
  }

  if (payload.note) {
    lines.push(`  Note: ${payload.note}`);
  }

  lines.push(`  Prompt:`);
  lines.push(indentBlock(payload.prompt, 4));

  lines.push(`  Permissions: ${payload.permissions.mode}`);

  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    lines.push(`  Metadata:`);
    lines.push(indentBlock(formatJson(payload.metadata), 4));
  }

  if (payload.artifacts) {
    lines.push(`  Artifacts:`);
    lines.push(`    dir: ${payload.artifacts.dir}`);
    lines.push(`    prompt: ${payload.artifacts.promptPath}`);
    lines.push(`    stdout: ${payload.artifacts.stdoutPath}`);
    lines.push(`    stderr: ${payload.artifacts.stderrPath}`);
    if (payload.artifacts.rawResultPath) lines.push(`    rawResult: ${payload.artifacts.rawResultPath}`);
    if (payload.artifacts.normalizedResultPath) lines.push(`    normalizedResult: ${payload.artifacts.normalizedResultPath}`);
    if (payload.artifacts.schemaPath) lines.push(`    schema: ${payload.artifacts.schemaPath}`);
    if (payload.artifacts.validationErrorPath) lines.push(`    validationError: ${payload.artifacts.validationErrorPath}`);
    if (payload.artifacts.permissionsPath) lines.push(`    permissions: ${payload.artifacts.permissionsPath}`);
    if (payload.artifacts.metadataPath) lines.push(`    metadata: ${payload.artifacts.metadataPath}`);
  }

  return lines.join("\n") + "\n";
}

export function formatVerboseResult(payload: AgentVerboseResultPayload, sequence?: number, timestamp?: string): string {
  const label = payload.label ?? payload.agentId;
  const dur = formatDuration(payload.durationMs);
  const lines: string[] = [];

  lines.push(`Agent result: ${label} ${payload.status} ${dur}`);
  if (sequence !== undefined && timestamp !== undefined) {
    lines.push(`  Event: #${sequence} ${timestamp}`);
  }
  lines.push(`  Exit code: ${payload.exitCode ?? "null"}`);

  lines.push(`  stdout:`);
  lines.push(indentBlock(payload.stdout.length > 0 ? payload.stdout : "(empty)", 4));

  lines.push(`  stderr:`);
  lines.push(indentBlock(payload.stderr.length > 0 ? payload.stderr : "(empty)", 4));

  if (payload.normalized !== undefined) {
    lines.push(`  Normalized response:`);
    lines.push(indentBlock(formatJson(payload.normalized), 4));
  }

  if (payload.parseWarnings && payload.parseWarnings.length > 0) {
    lines.push(`  Parse warnings:`);
    for (const warning of payload.parseWarnings) {
      lines.push(`    - ${warning}`);
    }
  }

  if (payload.error) {
    lines.push(`  Error: ${payload.error.message}`);
    if (payload.error.stack) {
      lines.push(indentBlock(payload.error.stack, 4));
    }
  }

  lines.push(`  Permissions: ${payload.permissions.mode}`);

  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    lines.push(`  Metadata:`);
    lines.push(indentBlock(formatJson(payload.metadata), 4));
  }

  if (payload.artifacts) {
    lines.push(`  Artifacts:`);
    lines.push(`    dir: ${payload.artifacts.dir}`);
    lines.push(`    prompt: ${payload.artifacts.promptPath}`);
    lines.push(`    stdout: ${payload.artifacts.stdoutPath}`);
    lines.push(`    stderr: ${payload.artifacts.stderrPath}`);
    if (payload.artifacts.rawResultPath) lines.push(`    rawResult: ${payload.artifacts.rawResultPath}`);
    if (payload.artifacts.normalizedResultPath) lines.push(`    normalizedResult: ${payload.artifacts.normalizedResultPath}`);
    if (payload.artifacts.schemaPath) lines.push(`    schema: ${payload.artifacts.schemaPath}`);
    if (payload.artifacts.validationErrorPath) lines.push(`    validationError: ${payload.artifacts.validationErrorPath}`);
    if (payload.artifacts.permissionsPath) lines.push(`    permissions: ${payload.artifacts.permissionsPath}`);
    if (payload.artifacts.metadataPath) lines.push(`    metadata: ${payload.artifacts.metadataPath}`);
  }

  return lines.join("\n") + "\n";
}

export function formatVerboseLoopStarted(payload: LoopStartedPayload, sequence?: number, timestamp?: string): string {
  const label = payload.label ?? payload.loopId;
  const lines: string[] = [];
  lines.push(`Loop started: ${label}`);
  if (sequence !== undefined && timestamp !== undefined) {
    lines.push(`  Event: #${sequence} ${timestamp}`);
  }
  lines.push(`  Max rounds: ${payload.maxRounds}`);
  if (payload.timeoutMs) lines.push(`  Timeout: ${formatDuration(payload.timeoutMs)}`);
  if (payload.artifactPath) lines.push(`  Artifacts: ${payload.artifactPath}`);
  return lines.join("\n") + "\n";
}

export function formatVerboseLoopRoundTerminal(payload: LoopRoundTerminalPayload, sequence?: number, timestamp?: string): string {
  const label = payload.label ?? payload.loopId;
  const dur = formatDuration(payload.durationMs);
  const lines: string[] = [];
  const roundNum = payload.roundNumber ?? (payload.roundIndex + 1);
  lines.push(`Loop round: ${label} round ${roundNum} ${payload.status} ${dur}`);
  if (sequence !== undefined && timestamp !== undefined) {
    lines.push(`  Event: #${sequence} ${timestamp}`);
  }
  if (payload.reason) lines.push(`  Reason: ${payload.reason}`);
  if (payload.artifactPath) lines.push(`  Artifacts: ${payload.artifactPath}`);
  if (payload.error) {
    lines.push(`  Error: ${payload.error.message}`);
  }
  return lines.join("\n") + "\n";
}

export function formatVerboseLoopTerminal(payload: LoopTerminalPayload, sequence?: number, timestamp?: string): string {
  const label = payload.label ?? payload.loopId;
  const dur = formatDuration(payload.durationMs);
  const lines: string[] = [];
  lines.push(`Loop finished: ${label} ${payload.status} ${dur}`);
  if (sequence !== undefined && timestamp !== undefined) {
    lines.push(`  Event: #${sequence} ${timestamp}`);
  }
  const rounds = payload.roundsCompleted ?? payload.roundCount;
  lines.push(`  Rounds: ${rounds}/${payload.maxRounds}`);
  if (payload.reason) lines.push(`  Reason: ${payload.reason}`);
  if (payload.artifactPath) lines.push(`  Artifacts: ${payload.artifactPath}`);
  if (payload.error) {
    lines.push(`  Error: ${payload.error.message}`);
  }
  return lines.join("\n") + "\n";
}

export function renderVerboseEvent(envelope: EventEnvelope): string | undefined {
  if (envelope.type === "agent.verbose.command") {
    return formatVerboseCommand(envelope.payload as AgentVerboseCommandPayload, envelope.sequence, envelope.timestamp);
  }
  if (envelope.type === "agent.verbose.result") {
    return formatVerboseResult(envelope.payload as AgentVerboseResultPayload, envelope.sequence, envelope.timestamp);
  }
  if (envelope.type === "loop.started") {
    return formatVerboseLoopStarted(envelope.payload as LoopStartedPayload, envelope.sequence, envelope.timestamp);
  }
  if (
    envelope.type === "loop.round.completed" ||
    envelope.type === "loop.round.failed" ||
    envelope.type === "loop.round.cancelled" ||
    envelope.type === "loop.round.timed_out"
  ) {
    return formatVerboseLoopRoundTerminal(envelope.payload as LoopRoundTerminalPayload, envelope.sequence, envelope.timestamp);
  }
  if (
    envelope.type === "loop.completed" ||
    envelope.type === "loop.failed" ||
    envelope.type === "loop.cancelled" ||
    envelope.type === "loop.timed_out" ||
    envelope.type === "loop.max_rounds"
  ) {
    return formatVerboseLoopTerminal(envelope.payload as LoopTerminalPayload, envelope.sequence, envelope.timestamp);
  }
  return undefined;
}
