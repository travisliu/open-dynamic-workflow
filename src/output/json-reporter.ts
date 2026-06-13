import type { Reporter, ReporterStartInput, ReporterStreams, ReporterOptions } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";
import { renderVerboseEvent } from "./verbose-formatter.js";

export class JsonReporter implements Reporter {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly verbose: boolean;

  constructor(streams: ReporterStreams, options?: ReporterOptions) {
    this.stdout = streams.stdout;
    this.stderr = streams.stderr;
    this.verbose = !!options?.verbose;
  }

  start(input: ReporterStartInput): void {
    // start() writes nothing
  }

  handle(event: EventEnvelope): void {
    if (this.verbose) {
      const verboseBlock = renderVerboseEvent(event);
      if (verboseBlock) {
        this.stderr.write(verboseBlock);
      }
    }
  }

  finish(result: WorkflowRunResult): void {
    // finish() writes the final report to stdout
    this.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }

  // Helper for operational warnings if needed, writing to stderr
  warn(message: string): void {
    this.stderr.write(`warning: ${message}\n`);
  }
}
