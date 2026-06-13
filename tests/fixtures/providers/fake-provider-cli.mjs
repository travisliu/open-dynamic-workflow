#!/usr/bin/env node
/**
 * Generic fake provider CLI for integration tests.
 */
const argv = process.argv.slice(2);

// Echo received argv to stderr for test assertions
process.stderr.write(JSON.stringify({ 
  argv,
  env: {
    OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
    MY_APP_SECRET: process.env.MY_APP_SECRET
  }
}) + "\n");

// Check if we should emit Copilot-like JSONL
const isCopilot = argv.includes("--provider") && argv[argv.indexOf("--provider") + 1] === "copilot";

if (isCopilot) {
  process.stdout.write(JSON.stringify({type:"session_started",id:"fake-copilot"}) + "\n");
  let content = "Fake Copilot provider response";
  if (argv.some(a => a.includes("Return JSON"))) {
    content = "Result: ```json\n{\"ok\":true,\"files\":[\"src/agents/github-copilot-cli.ts\"]}\n```";
  } else if (argv.some(a => a.includes("Return invalid JSON"))) {
    content = "Result: ```json\n{\"ok\": \"missing closing quote}\n```";
  } else if (argv.some(a => a.includes("Return schema-invalid JSON"))) {
    content = "Result: ```json\n{\"ok\": false}\n```"; 
  }
  process.stdout.write(JSON.stringify({type:"assistant_message",message:{role:"assistant",content}}) + "\n");
} else {
  // Emit a generic JSON response to stdout
  const response = {
    text: "Fake provider response",
    content: "Fake provider response content", // For opencode heuristics
    argv_received: argv
  };

  process.stdout.write(JSON.stringify(response) + "\n");
}

process.exit(0);
