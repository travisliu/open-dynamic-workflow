import type { Reporter, ReporterStartInput, ReporterStreams } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";

export class JsonReporter implements Reporter {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;

  constructor(streams: ReporterStreams) {
    this.stdout = streams.stdout;
    this.stderr = streams.stderr;
  }

  start(input: ReporterStartInput): void {
    // start() writes nothing
  }

  handle(event: EventEnvelope): void {
    // handle() writes nothing
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
