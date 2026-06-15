#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { resumeCommand } from "./commands/resume.js";
import { validateCommand } from "./commands/validate.js";
import { doctorCommand } from "./commands/doctor.js";
import { listCommand } from "./commands/list.js";
import { OpenFlowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { getPackageVersion } from "./package-info.js";

function collectArgs(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  const version = await getPackageVersion();

  program
    .name("openflow")
    .description("Orchestrate coding-agent CLI workflows")
    .version(version)
    .exitOverride((err) => {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.help" || err.code === "commander.version") {
        throw err;
      }
      // Throw CLI usage error on command parsing errors
      throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, err.message, { cause: err });
    });

  program
    .command("init")
    .description("Initialize a project for OpenFlow")
    .option("--yes", "Run non-interactively with defaults")
    .option("--provider <name>", "Default provider for generated config")
    .option("--force", "Overwrite generated files if they already exist")
    .option("--strict", "Fail before writing if any target path already exists")
    .option("--run-smoke-test", "Validate and run the generated example workflow with mock")
    .option("-r, --report <mode>", "Smoke-test report mode (pretty, json)")
    .option("--cwd <path>", "Project working directory")
    .option("--workflows-dir <path>", "Generated workflows directory")
    .option("--agents-dir <path>", "Shared agents directory")
    .option("--tools-dir <path>", "Tools directory")
    .addHelpText(
      "after",
      `
Examples:
  openflow init
  openflow init --yes
  openflow init --yes --run-smoke-test
  openflow init --strict
  openflow init --force --provider codex
`
    )
    .action(async (options) => {
      await initCommand({ rawOptions: options });
    });

  program
    .command("list [resourceType]")
    .description("List discoverable workflows, shared agents, and tools")
    .option("--dir <path>", "Directory to scan for targeted list commands")
    .option("--workflows-dir <path>", "Directory to scan for workflows")
    .option("--agents-dir <path>", "Directory to scan for shared agents")
    .option("--tools-dir <path>", "Directory to scan for tools")
    .option("-r, --report <mode>", "Output format (pretty, json, jsonl)")
    .option("-v, --verbose", "Show extended metadata")
    .option("--strict", "Fail if any discovered file is invalid")
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Project working directory")
    .addHelpText(
      "after",
      `
Examples:
  openflow list
  openflow list workflows
  openflow list agents --verbose
  openflow list tools --report json
  openflow list --strict
  openflow list workflows --dir examples/workflows
`
    )
    .action(async (resourceType, options) => {
      await listCommand({ resourceType, rawOptions: options });
    });

  program
    .command("run")
    .argument("<workflow-name-or-file>", "Workflow name or workflow file path")
    .option("-p, --provider <name>", "Default agent provider name")
    .option("-m, --model <model>", "Default model for agent calls")
    .option("-a, --arg <key=value>", "Workflow input argument (can be repeated)", collectArgs, [])
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("-r, --report <mode>", "Reporter mode (pretty, json, jsonl)")
    .option("--concurrency <number>", "Maximum parallel concurrency")
    .option("--timeout-ms <ms>", "Workflow run timeout in ms")
    .option("--resume <run-id-or-path>", "Resume from a previous run cache")
    .option("--no-cache", "Disable resume/cache lookup and cache index updates")
    .option("--dry-run", "Validate and print summary without invoking providers")
    .option("--fail-fast", "Stop immediately on first agent step failure")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (workflowFile, options) => {
      await runCommand({ workflowFile, rawOptions: options });
    });

  program
    .command("resume")
    .argument("<run-id-or-path>", "Previous run id or run directory path")
    .option("--cwd <path>", "Custom working directory")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("-r, --report <mode>", "Reporter mode (pretty, json, jsonl)")
    .option("--no-cache", "Disable resume/cache lookup and cache index updates")
    .action(async (runIdOrPath, options) => {
      await resumeCommand({ runIdOrPath, rawOptions: options });
    });

  program
    .command("validate")
    .argument("<workflow-name-or-file>", "Workflow name or workflow file path")
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (target, options) => {
      if (!target) {
        throw new OpenFlowError(ErrorCode.CLI_USAGE_ERROR, "Missing <workflow-name-or-file>");
      }
      await validateCommand({ workflowFile: target, rawOptions: options });
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

