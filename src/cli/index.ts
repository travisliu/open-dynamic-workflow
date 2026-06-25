#!/usr/bin/env node

import path from "node:path";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { runCommand } from "./commands/run.js";
import { resumeCommand } from "./commands/resume.js";
import { validateCommand } from "./commands/validate.js";
import { doctorCommand } from "./commands/doctor.js";
import { listCommand } from "./commands/list.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { ErrorCode } from "../errors/codes.js";
import { getPackageVersion } from "./package-info.js";
import { exitCodeForError } from "../errors/exit-codes.js";
import { renderCliError } from "./error-output.js";


function collectArgs(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  const version = await getPackageVersion();

  // Detect if invoked via odw or the full name
  const binName = argv[1] ? path.basename(argv[1]) : "odw";
  const displayName = binName.startsWith("odw") ? "odw" : "open-dynamic-workflow";

  program
    .name(displayName)
    .description("Orchestrate coding-agent CLI workflows (alias: odw)")
    .version(version)
    .exitOverride((err) => {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.help" || err.code === "commander.version") {
        throw err;
      }
      // Throw CLI usage error on command parsing errors
      throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, err.message, { cause: err });
    });

  program
    .command("init")
    .description("Initialize a project for Open Dynamic Workflow")
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
  ${displayName} init
  ${displayName} init --yes
  ${displayName} init --yes --run-smoke-test
  ${displayName} init --strict
  ${displayName} init --force --provider codex
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
  ${displayName} list
  ${displayName} list workflows
  ${displayName} list agents --verbose
  ${displayName} list tools --report json
  ${displayName} list --strict
  ${displayName} list workflows --dir examples/workflows
`
    )
    .action(async (resourceType, options) => {
      options.__invokedBinaryName = displayName;
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
    .option("--max-agent-calls <number>", "Maximum live provider agent calls for this run")
    .option("--resume <run-id-or-path>", "Resume from a previous run cache")
    .option("--no-cache", "Disable resume/cache lookup and cache index updates")
    .option("--dry-run", "Validate and print summary without invoking providers")
    .option("--fail-fast", "Stop immediately on first agent step failure")
    .option("-v, --verbose", "Enable verbose logging")
    .option("--thinking-effort <effort>", "Thinking effort level for supported providers (off, minimal, low, medium, high, xhigh)")
    .addHelpText(
      "after",
      `
Examples:
  ${displayName} run my-workflow
  ${displayName} run my-workflow --provider gemini
  ${displayName} run my-workflow --arg key1=val1 --arg key2=val2
  ${displayName} run my-workflow --report json
  ${displayName} run my-workflow --dry-run
`
    )
    .action(async (workflowFile, options) => {
      options.__invokedBinaryName = displayName;
      await runCommand({ workflowFile, rawOptions: options });
    });

  program
    .command("resume")
    .argument("<run-id-or-path>", "Previous run id or run directory path")
    .option("--cwd <path>", "Custom working directory")
    .option("-o, --out <path>", "Runs artifact directory")
    .option("-r, --report <mode>", "Reporter mode (pretty, json, jsonl)")
    .option("--max-agent-calls <number>", "Maximum live provider agent calls for the continuation run")
    .option("--no-cache", "Disable resume/cache lookup and cache index updates")
    .addHelpText(
      "after",
      `
Examples:
  ${displayName} resume last-run
  ${displayName} resume .open-dynamic-workflow/runs/2025-01-01T00-00-00Z
  ${displayName} resume last-run --report pretty
`
    )
    .action(async (runIdOrPath, options) => {
      await resumeCommand({ runIdOrPath, rawOptions: options });
    });

  program
    .command("validate")
    .argument("<workflow-name-or-file>", "Workflow name or workflow file path")
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-v, --verbose", "Enable verbose logging")
    .addHelpText(
      "after",
      `
Examples:
  ${displayName} validate my-workflow
  ${displayName} validate workflows/my-workflow.ts
  ${displayName} validate my-workflow --verbose
`
    )
    .action(async (target, options) => {
      if (!target) {
        throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, "Missing <workflow-name-or-file>");
      }
      options.__invokedBinaryName = displayName;
      await validateCommand({ workflowFile: target, rawOptions: options });
    });

  program
    .command("doctor")
    .option("-c, --config <path>", "Path to config file")
    .option("--cwd <path>", "Custom working directory")
    .option("-v, --verbose", "Enable verbose logging")
    .addHelpText(
      "after",
      `
Examples:
  ${displayName} doctor
  ${displayName} doctor --verbose
`
    )
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

// Backward compatibility helpers and runner for the legacy @prmflow/openflow wrapper package.
function objectCode(value: unknown): string | undefined {
  if (value && typeof value === "object" && "code" in value && typeof value.code === "string") {
    return value.code;
  }
  return undefined;
}

function errorCause(value: unknown): unknown {
  if (value && typeof value === "object" && "cause" in value) {
    return value.cause;
  }
  return undefined;
}

function isCommanderControlError(error: unknown): boolean {
  const code = objectCode(error);
  const causeCode = objectCode(errorCause(error));
  return (
    code === "commander.helpDisplayed" ||
    code === "commander.help" ||
    code === "commander.version" ||
    causeCode === "commander.helpDisplayed" ||
    causeCode === "commander.help" ||
    causeCode === "commander.version"
  );
}

function isCommanderUsageError(error: unknown): boolean {
  if (!(error instanceof OpenDynamicWorkflowError)) {
    return false;
  }
  const causeCode = objectCode(error.cause);
  return typeof causeCode === "string" && causeCode.startsWith("commander.");
}

export async function runCli(args: string[]): Promise<void> {
  const fullArgv = [
    process.argv[0] ?? "node",
    process.argv[1] ?? "open-dynamic-workflow",
    ...args
  ];
  try {
    await main(fullArgv);
  } catch (error) {
    if (isCommanderControlError(error)) {
      process.exitCode = 0;
      return;
    }

    renderCliError(error, { argv: fullArgv });

    process.exitCode = exitCodeForError(error);
  }
}


