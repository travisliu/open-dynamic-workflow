#!/usr/bin/env node

import { main } from "./cli/index.js";
import { exitCodeForError } from "./errors/exit-codes.js";

function ignoreBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }
    throw error;
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

main(process.argv.slice(2)).catch((error) => {
  if (error && typeof error === "object") {
    const errObj = error as any;
    if (errObj.code === "commander.helpDisplayed" || errObj.code === "commander.help" || errObj.code === "commander.version" ||
        (errObj.cause && (errObj.cause.code === "commander.helpDisplayed" || errObj.cause.code === "commander.help" || errObj.cause.code === "commander.version"))) {
      process.exitCode = 0;
      return;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = exitCodeForError(error);
});
