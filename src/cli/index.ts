#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./commands/run.js";
import { resumeCommand } from "./commands/resume.js";
import { validateCommand } from "./commands/validate.js";
import { doctorCommand } from "./commands/doctor.js";
import { inspectCommand, killCommand, listCommand, watchCommand } from "./commands/runs.js";
import { exitCodeForError } from "../errors/exit-codes.js";
import { serializeError } from "../errors/serialize.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";

function collectArgs(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

async function readPackageVersion(): Promise<string> {
  try {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../package.json"
    );
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("openflow")
    .description("Orchestrate coding-agent CLI workflows")
    .version(await readPackageVersion())
    .exitOverride((err) => {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.help" || err.code === "commander.version") {
        throw err;
      }
      // Throw CLI usage error on command parsing errors
      throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, err.message, { cause: err });
    });

  program
    .command("run")
    .argument("<workflow-file>", "Path to workflow file")
    .option("-p, --provider <name>", "Default agent provider name")
    .option("-m, --model <model>", "Default model for agent calls")
    .option("-a, --arg <key=value>", "Workflow input argument (can be repeated)", collectArgs, [])
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("-r, --report <mode>", "Reporter mode (pretty, json, jsonl)")
    .option("--concurrency <number>", "Maximum parallel concurrency")
    .option("--timeout-ms <ms>", "Workflow run timeout in ms")
    .option("--max-agent-calls <number>", "Maximum live provider agent calls for this run")
    .option("--max-observed-tokens <number>", "Maximum observed provider-reported tokens for this run")
    .option("--max-run-ms <ms>", "Workflow run wall-clock budget in ms")
    .option("--resume <run-id-or-path>", "Resume from a previous run cache")
    .option("--no-cache", "Disable resume/cache lookup and cache index updates")
    .option("--background", "Run workflow in a detached background worker")
    .option("--background-worker", "Internal background worker mode")
    .option("--run-id <id>", "Internal run id override")
    .option("--dry-run", "Validate and print summary without invoking providers")
    .option("--fail-fast", "Stop immediately on first agent step failure")
    .option("-v, --verbose", "Enable verbose logging")
    .option("--allow-shell", "Enable shell execution (unsupported)")
    .option("--isolation <type>", "Isolation mechanism (unsupported)")
    .option("--retry", "Retry count (unsupported)")
    .action(async (workflowFile, options) => {
      if (options.allowShell) {
        throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, "--allow-shell is not supported in the MVP.");
      }
      if (options.isolation) {
        throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, `--isolation is not supported in the MVP.`);
      }
      if (options.retry) {
        throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, "--retry is not supported in the MVP.");
      }
      await runCommand({ workflowFile, rawOptions: options });
    });

  program
    .command("list")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("--cwd <path>", "Custom working directory")
    .option("--json", "Print JSON")
    .action(async (options) => {
      await listCommand({ rawOptions: options });
    });

  program
    .command("resume")
    .argument("<run-id-or-path>", "Pending run id or run artifact path")
    .argument("[input]", "Resume input for a single pending pause")
    .option("--pause <id>", "Pending pause id when a run has multiple pending pauses")
    .option("--input <value>", "Resume input value")
    .option("--input-file <path>", "Read resume input from a file")
    .option("-o, --out <path>", "Runs artifact directory for resolving run ids")
    .option("--cwd <path>", "Custom working directory for resolving relative paths")
    .option("-r, --report <mode>", "Reporter mode (pretty, json, jsonl)")
    .option("--fail-fast", "Stop immediately on first agent step failure")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (runIdOrPath, inputValue, options) => {
      await resumeCommand({ runIdOrPath, inputValue, rawOptions: options });
    });

  program
    .command("inspect")
    .argument("<run-id-or-path>", "Run id or run artifact path")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("--cwd <path>", "Custom working directory")
    .option("--json", "Print JSON")
    .action(async (runIdOrPath, options) => {
      await inspectCommand({ runIdOrPath, rawOptions: options });
    });

  program
    .command("watch")
    .argument("<run-id-or-path>", "Run id or run artifact path")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("--cwd <path>", "Custom working directory")
    .option("--jsonl", "Print raw event JSONL")
    .action(async (runIdOrPath, options) => {
      await watchCommand({ runIdOrPath, rawOptions: options });
    });

  program
    .command("kill")
    .argument("<run-id-or-path>", "Run id or run artifact path")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("--cwd <path>", "Custom working directory")
    .option("--signal <signal>", "Signal to send", "SIGTERM")
    .option("--json", "Print JSON")
    .action(async (runIdOrPath, options) => {
      await killCommand({ runIdOrPath, rawOptions: options });
    });

  program
    .command("validate")
    .argument("<workflow-file>", "Path to workflow file")
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (workflowFile, options) => {
      if (!workflowFile) {
        throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, "Missing <workflow-file>");
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

  let parseOptions: { from: "node" | "user" } | undefined = undefined;
  if (
    argv.length >= 2 &&
    (argv[0] === "node" ||
      argv[0]?.endsWith("node") ||
      argv[0]?.endsWith("npm") ||
      argv[0]?.includes("/bin/"))
  ) {
    parseOptions = { from: "node" };
  } else {
    parseOptions = { from: "user" };
  }

  await program.parseAsync(argv, parseOptions);
}
