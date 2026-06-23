#!/usr/bin/env node

import { main } from "../cli/index.js";
import { exitCodeForError } from "../errors/exit-codes.js";
import { OpenDynamicWorkflowError } from "../errors/types.js";
import { renderCliError } from "../cli/error-output.js";

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

main(process.argv).catch((error) => {
  if (isCommanderControlError(error)) {
    process.exitCode = 0;
    return;
  }

  renderCliError(error, { argv: process.argv });

  process.exitCode = exitCodeForError(error);
});
