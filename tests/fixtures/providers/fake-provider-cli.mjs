#!/usr/bin/env node
/**
 * Generic fake provider CLI for integration tests.
 */
const argv = process.argv.slice(2);

// Echo received argv to stderr for test assertions
process.stderr.write(JSON.stringify({ 
  argv,
  env: {
    OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT
  }
}) + "\n");

// Emit a generic JSON response to stdout
const response = {
  text: "Fake provider response",
  content: "Fake provider response content", // For opencode heuristics
  argv_received: argv
};

process.stdout.write(JSON.stringify(response) + "\n");
process.exit(0);
