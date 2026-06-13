import type { ListReportMode, ListResult } from "../discovery/types.js";
import { ListPrettyReporter } from "./list-pretty-reporter.js";
import { ListJsonReporter } from "./list-json-reporter.js";
import { ListJsonlReporter } from "./list-jsonl-reporter.js";

export interface ListReporter {
  render(result: ListResult): void;
}

export interface ListReporterStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface ListReporterOptions {
  mode: ListReportMode;
  streams?: Partial<ListReporterStreams>;
  verbose?: boolean;
}

export function createListReporter(options: ListReporterOptions): ListReporter {
  const streams: ListReporterStreams = {
    stdout: options.streams?.stdout ?? process.stdout,
    stderr: options.streams?.stderr ?? process.stderr,
  };

  switch (options.mode) {
    case "pretty":
      return new ListPrettyReporter(streams, !!options.verbose);
    case "json":
      return new ListJsonReporter(streams, !!options.verbose);
    case "jsonl":
      return new ListJsonlReporter(streams, !!options.verbose);
    default:
      throw new Error(`Unsupported report mode: ${options.mode}`);
  }
}
