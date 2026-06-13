import { loadConfig } from "../../config/load.js";
import { parseReportMode, parseListResourceType } from "../args.js";
import { resolveDiscoveryDirectories } from "../../discovery/directories.js";
import { createDiscoveryService } from "../../discovery/service.js";
import { createListReporter } from "../../output/list-reporter.js";
import { mapListExitCode } from "../../errors/list-errors.js";
import { OpenFlowError } from "../../errors/types.js";
import { ErrorCode } from "../../errors/codes.js";
import type { DiscoveryService, ListCliResourceType } from "../../discovery/types.js";

export interface ListCommandInput {
  resourceType?: string;
  rawOptions: any;
  deps?: {
    discoveryService?: DiscoveryService;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
  };
}

export function validateListDirectoryFlags(cliResourceType: ListCliResourceType, rawOptions: any): void {
  const hasTypeSpecificFlags =
    rawOptions.workflowsDir !== undefined ||
    rawOptions.agentsDir !== undefined ||
    rawOptions.toolsDir !== undefined;

  if (cliResourceType === "all") {
    if (rawOptions.dir !== undefined) {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        "Option '--dir' is ambiguous when listing all resource types. Use resource-specific flags like '--workflows-dir', '--agents-dir', or '--tools-dir' instead."
      );
    }
  } else {
    // Targeted command (workflows, agents, tools)
    if (hasTypeSpecificFlags) {
      throw new OpenFlowError(
        ErrorCode.CLI_USAGE_ERROR,
        `Resource-specific directory flags (e.g., '--workflows-dir') are invalid on targeted list commands. Use '--dir <path>' instead when running 'openflow list ${cliResourceType}s'.`
      );
    }
  }
}

export async function listCommand(input: ListCommandInput): Promise<void> {
  const rawOptions = input.rawOptions ?? {};
  const cwd = rawOptions.cwd ?? process.cwd();
  const cliResourceType = parseListResourceType(input.resourceType);
  const reportMode = rawOptions.report ? parseReportMode(rawOptions.report) : undefined;

  validateListDirectoryFlags(cliResourceType, rawOptions);

  const config = await loadConfig({
    cwd,
    configPath: rawOptions.config,
    cli: {
      report: reportMode,
      verbose: rawOptions.verbose,
    },
  });

  const directories = resolveDiscoveryDirectories({
    resourceType: cliResourceType,
    rawOptions,
    config,
    cwd: config.cwd,
  });

  const resourceTypes =
    cliResourceType === "all" ? (["workflow", "agent", "tool"] as const) : [cliResourceType];

  const service = input.deps?.discoveryService ?? createDiscoveryService();
  const result = await service.discover({
    cwd: config.cwd,
    resourceTypes: [...resourceTypes],
    directories,
    verbose: !!rawOptions.verbose,
    strict: !!rawOptions.strict,
  });

  const reporter = createListReporter({
    mode: config.reporting.mode,
    streams: {
      stdout: input.deps?.stdout ?? process.stdout,
      stderr: input.deps?.stderr ?? process.stderr,
    },
    verbose: config.reporting.verbose,
  });
  reporter.render(result);
  process.exitCode = mapListExitCode(result, { strict: !!rawOptions.strict });
}
