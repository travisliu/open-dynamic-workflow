import { serializeError } from "../errors/serialize.js";
import type { InitializationHint } from "../errors/project-init-hint.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";

export type ListReportMode = "pretty" | "json" | "jsonl";

export interface ErrorOutputContext {
  argv: string[];
  invokedBinaryName?: string;
  streams?: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  };
}

export interface SerializedErrorWithHint {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: unknown;
  hint?: InitializationHint;
}

export function serializeErrorWithHint(error: unknown): SerializedErrorWithHint {
  const serialized = serializeError(error) as SerializedErrorWithHint;
  if (error && typeof error === "object" && "hint" in error) {
    serialized.hint = (error as any).hint;
  }
  return serialized;
}

function objectCode(value: unknown): string | undefined {
  if (value && typeof value === "object" && "code" in value && typeof value.code === "string") {
    return value.code;
  }
  return undefined;
}

function errorCause(value: unknown): unknown {
  if (value && typeof value === "object" && "cause" in value) {
    return value.cause;
  }
  return undefined;
}

export function isCommanderUsageError(error: unknown): boolean {
  if (!(error instanceof OpenDynamicWorkflowError)) {
    return false;
  }
  const causeCode = objectCode(error.cause);
  return typeof causeCode === "string" && causeCode.startsWith("commander.");
}

export function parseReportModeAndCommand(argv: string[]): { command?: string | undefined; report?: ListReportMode | undefined } {
  let command: string | undefined;
  let report: ListReportMode | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-r" || arg === "--report") {
      const next = argv[i + 1];
      if (next === "json" || next === "jsonl" || next === "pretty") {
        report = next as ListReportMode;
      }
    } else if (arg.startsWith("--report=")) {
      const val = arg.split("=")[1];
      if (val === "json" || val === "jsonl" || val === "pretty") {
        report = val as ListReportMode;
      }
    } else if (arg.startsWith("-r=")) {
      const val = arg.split("=")[1];
      if (val === "json" || val === "jsonl" || val === "pretty") {
        report = val as ListReportMode;
      }
    }
  }

  let startIndex = 0;
  if (argv.length >= 2 && (argv[0]?.endsWith("node") || argv[0]?.includes("/bin/"))) {
    startIndex = 2;
  }
  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      command = arg;
      break;
    }
  }

  return { command, report };
}

export function renderCliError(error: unknown, context: ErrorOutputContext): void {
  const stderr = context.streams?.stderr ?? process.stderr;
  const { command, report } = parseReportModeAndCommand(context.argv);

  if (command === "run" && (report === "json" || report === "jsonl")) {
    writeMachineReadableCliError(error, context);
    return;
  }

  if (isCommanderUsageError(error)) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);

  if (error && typeof error === "object" && "hint" in error) {
    const hint = (error as any).hint as InitializationHint;
    if (hint && hint.message) {
      stderr.write(`Hint: ${hint.message}\n`);
    }
  }
}

export function writeMachineReadableCliError(error: unknown, context: ErrorOutputContext): void {
  const stdout = context.streams?.stdout ?? process.stdout;
  const { report } = parseReportModeAndCommand(context.argv);
  const serialized = serializeErrorWithHint(error);

  if (report === "json") {
    const envelope = {
      schemaVersion: "open-dynamic-workflow.error.v1",
      status: "failed",
      error: serialized,
    };
    stdout.write(JSON.stringify(envelope, null, 2) + "\n");
  } else if (report === "jsonl") {
    const envelope = {
      schemaVersion: "open-dynamic-workflow.error.v1",
      type: "cli.error",
      error: serialized,
    };
    stdout.write(JSON.stringify(envelope) + "\n");
  }
}
