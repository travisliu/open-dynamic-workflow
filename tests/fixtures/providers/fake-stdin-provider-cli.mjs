#!/usr/bin/env node
/**
 * Fake provider CLI that records stdin for integration tests.
 */
const argv = process.argv.slice(2);

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});

process.stdin.on("end", () => {
  process.stderr.write(JSON.stringify({
    argv,
    stdin_received_length: stdin.length
  }) + "\n");

  process.stdout.write(JSON.stringify({
    text: "Fake stdin provider response",
    stdin_received_length: stdin.length,
    stdin_received_preview: stdin.slice(0, 64),
    argv_received: argv
  }) + "\n");

  process.exit(0);
});

process.stdin.resume();
