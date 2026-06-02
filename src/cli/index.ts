#!/usr/bin/env node

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { validateCommand } from "./commands/validate.js";
import { doctorCommand } from "./commands/doctor.js";
import { exitCodeForError } from "../errors/exit-codes.js";
import { serializeError } from "../errors/serialize.js";
import { ExecflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

function collectArgs(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("execflow")
    .description("Orchestrate coding-agent CLI workflows")
    .version("0.0.0")
    .exitOverride((err) => {
      // Throw CLI usage error on command parsing errors
      throw new ExecflowError(ErrorCode.CLI_USAGE_ERROR, err.message, { cause: err });
    });

  program
    .command("run")
    .argument("<workflow-file>", "Path to workflow file")
    .option("-p, --provider <name>", "Default agent provider name")
    .option("-a, --arg <key=value>", "Workflow input argument (can be repeated)", collectArgs, [])
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("-r, --report <mode>", "Reporter mode (pretty, json, jsonl)")
    .option("--concurrency <number>", "Maximum parallel concurrency")
    .option("--timeout-ms <ms>", "Workflow run timeout in ms")
    .option("--dry-run", "Validate and print summary without invoking providers")
    .option("--fail-fast", "Stop immediately on first agent step failure")
    .option("-v, --verbose", "Enable verbose logging")
    .option("--allow-shell", "Enable shell execution (unsupported)")
    .option("--isolation <type>", "Isolation mechanism (unsupported)")
    .option("--retry", "Retry count (unsupported)")
    .action(async (workflowFile, options) => {
      if (options.allowShell) {
        throw new ExecflowError(ErrorCode.CLI_USAGE_ERROR, "--allow-shell is not supported in the MVP.");
      }
      if (options.isolation) {
        throw new ExecflowError(ErrorCode.CLI_USAGE_ERROR, `--isolation is not supported in the MVP.`);
      }
      if (options.retry) {
        throw new ExecflowError(ErrorCode.CLI_USAGE_ERROR, "--retry is not supported in the MVP.");
      }
      await runCommand({ workflowFile, rawOptions: options });
    });

  program
    .command("validate")
    .argument("<workflow-file>", "Path to workflow file")
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (workflowFile, options) => {
      if (!workflowFile) {
        throw new ExecflowError(ErrorCode.CLI_USAGE_ERROR, "Missing <workflow-file>");
      }
      await validateCommand({ workflowFile, rawOptions: options });
    });

  program
    .command("doctor")
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (options) => {
      await doctorCommand({ rawOptions: options });
    });

  await program.parseAsync(argv);
}

// Execute CLI only when run directly as binary script
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/execflow") || process.argv[1]?.endsWith("/cli/index.js");
if (isMain || process.env.NODE_ENV !== "test") {
  main(process.argv).catch((error) => {
    const serialized = serializeError(error);
    console.error(serialized.message);
    process.exitCode = exitCodeForError(error);
  });
}
