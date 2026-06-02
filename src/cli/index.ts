#!/usr/bin/env node
import { doctorCommand } from "./commands/doctor.js";
import { runCommand } from "./commands/run.js";
import { validateCommand } from "./commands/validate.js";
import { EXIT_CODES } from "../types/errors.js";

function printHelp(): void {
  console.log(`execflow phase0

Usage:
  execflow run <workflow-file> [--dry-run]
  execflow validate <workflow-file>
  execflow doctor
  execflow --help

Phase 0 provides command routing and shared TypeScript contracts only.`);
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return EXIT_CODES.SUCCESS;
  }

  switch (command) {
    case "run": {
      const dryRun = rest.includes("--dry-run");
      const workflowFile = rest.find((arg) => !arg.startsWith("--"));
      return runCommand({ workflowFile, dryRun });
    }
    case "validate": {
      const workflowFile = rest.find((arg) => !arg.startsWith("--"));
      return validateCommand({ workflowFile });
    }
    case "doctor":
      return doctorCommand();
    default:
      console.error(`error: unknown command '${command}'`);
      printHelp();
      return EXIT_CODES.CLI_USAGE_ERROR;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = EXIT_CODES.INTERNAL_ERROR;
  });
