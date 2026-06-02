#!/usr/bin/env node

import { main } from "./cli/index.js";
import { exitCodeForError } from "./errors/exit-codes.js";
import { serializeError } from "./errors/serialize.js";

main(process.argv).catch((error) => {
  const serialized = serializeError(error);
  console.error(serialized.message);
  process.exitCode = exitCodeForError(error);
});
