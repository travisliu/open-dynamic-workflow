import type { ListResult, ListedResource } from "../discovery/types.js";
import type { ListReporter, ListReporterStreams } from "./list-reporter.js";

export class ListJsonlReporter implements ListReporter {
  constructor(private streams: ListReporterStreams, private verbose: boolean) {}

  render(result: ListResult): void {
    for (const resource of result.resources) {
      this.streams.stdout.write(
        JSON.stringify({
          schemaVersion: "openflow.list.v1",
          type: "list.resource",
          resource: this.filterResource(resource),
        }) + "\n"
      );
    }

    for (const warning of result.warnings) {
      this.streams.stdout.write(
        JSON.stringify({
          schemaVersion: "openflow.list.v1",
          type: "list.warning",
          warning,
        }) + "\n"
      );
    }

    for (const error of result.errors) {
      this.streams.stdout.write(
        JSON.stringify({
          schemaVersion: "openflow.list.v1",
          type: "list.error",
          error,
        }) + "\n"
      );
    }

    this.streams.stdout.write(
      JSON.stringify({
        schemaVersion: "openflow.list.v1",
        type: "list.summary",
        summary: result.summary,
      }) + "\n"
    );
  }

  private filterResource(resource: ListedResource): ListedResource {
    const { ...rest } = resource as any;
    delete rest.agentPrompt;
    delete rest.sourceCode;
    return rest;
  }
}
