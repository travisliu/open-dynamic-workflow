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

export function createReporter(options: {
  mode: ReporterMode;
  streams?: Partial<ReporterStreams>;
  verbose?: boolean;
}): Reporter {
  const streams: ReporterStreams = {
    stdout: options.streams?.stdout ?? process.stdout,
    stderr: options.streams?.stderr ?? process.stderr
  };

  switch (options.mode) {
    case "pretty": {
      const prettyOpts: { verbose?: boolean } = {};
      if (options.verbose !== undefined) {
        prettyOpts.verbose = options.verbose;
      }
      return new PrettyReporter(streams, prettyOpts);
    }
    case "json":
      return new JsonReporter(streams);
    case "jsonl":
      return new JsonlReporter(streams);
    default:
      throw new Error(`Unsupported reporter mode: ${options.mode}`);
  }
}
