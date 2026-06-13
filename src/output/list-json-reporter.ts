import type { ListResult, ListedResource } from "../discovery/types.js";
import type { ListReporter, ListReporterStreams } from "./list-reporter.js";

export class ListJsonReporter implements ListReporter {
  constructor(private streams: ListReporterStreams, private verbose: boolean) {}

  render(result: ListResult): void {
    const filteredResult = {
      ...result,
      resources: result.resources.map(this.filterResource.bind(this))
    };
    this.streams.stdout.write(JSON.stringify(filteredResult, null, 2) + "\n");
  }

  private filterResource(resource: ListedResource): ListedResource {
    const { ...rest } = resource as any;
    delete rest.agentPrompt;
    delete rest.sourceCode;
    return rest;
  }
}
