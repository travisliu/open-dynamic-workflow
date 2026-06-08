#!/usr/bin/env node
/**
 * Fake Gemini CLI for integration tests.
 *
 * Accepts the argv shape the real adapter will produce.
 * Writes a small JSON object to stdout so parseResult() succeeds.
 * Echoes received argv to stderr so tests can assert --approval-mode yolo.
 * Exits 0.
 *
 * This script must not require real Gemini credentials.
 */

const argv = process.argv.slice(2);

// Echo received argv to stderr for test assertions
process.stderr.write(JSON.stringify({ argv }) + "\n");

// Emit a valid Gemini-style JSON response to stdout
const response = {
  text: "Fake gemini response for integration test",
  argv_received: argv
};

process.stdout.write(JSON.stringify(response) + "\n");

process.exit(0);
