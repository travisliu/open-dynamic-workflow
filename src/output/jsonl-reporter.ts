import type { Reporter, ReporterStartInput, ReporterStreams } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import type { WorkflowRunResult } from "../types/workflow.js";

export class JsonlReporter implements Reporter {
  private readonly stdout: NodeJS.WritableStream;

  constructor(streams: ReporterStreams) {
    this.stdout = streams.stdout;
  }

  start(input: ReporterStartInput): void {
    // start() writes nothing
  }

  handle(event: EventEnvelope): void {
    // Writes exactly one line
    this.stdout.write(JSON.stringify(event) + "\n");
  }

  finish(result: WorkflowRunResult): void {
    // finish() writes nothing
  }
}
