import { PrettyReporter } from "./pretty-reporter.js";
import { JsonReporter } from "./json-reporter.js";
import { JsonlReporter } from "./jsonl-reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";
import type { ReporterMode } from "../types/common.js";

export interface ReporterStartInput {
  runId: string;
  meta: {
    name: string;
    description: string;
    phases?: string[];
  };
  artifactsDir: string;
}

export interface Reporter {
  start(input: ReporterStartInput): Promise<void> | void;
  handle(event: EventEnvelope): Promise<void> | void;
  finish(result: WorkflowRunResult): Promise<void> | void;
}

export interface ReporterStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface ReporterOptions {
  verbose?: boolean;
}

export function createReporter(options: {
  mode: ReporterMode;
  streams?: Partial<ReporterStreams>;
} & ReporterOptions): Reporter {
  const streams: ReporterStreams = {
    stdout: options.streams?.stdout ?? process.stdout,
    stderr: options.streams?.stderr ?? process.stderr
  };

  const reporterOptions: ReporterOptions = {};
  if (options.verbose !== undefined) {
    reporterOptions.verbose = options.verbose;
  }

  switch (options.mode) {
    case "pretty":
      return new PrettyReporter(streams, reporterOptions);
    case "json":
      return new JsonReporter(streams, reporterOptions);
    case "jsonl":
      return new JsonlReporter(streams, reporterOptions);
    default:
      throw new Error(`Unsupported reporter mode: ${options.mode}`);
  }
}
