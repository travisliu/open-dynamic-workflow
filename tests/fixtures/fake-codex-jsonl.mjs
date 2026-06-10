import * as fs from "node:fs";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});

function incrementCounter() {
  const counterPath = process.env.OPENFLOW_FAKE_CODEX_COUNTER;
  if (!counterPath) return;
  const previous = fs.existsSync(counterPath)
    ? Number(fs.readFileSync(counterPath, "utf8") || "0")
    : 0;
  fs.writeFileSync(counterPath, String(previous + 1), "utf8");
}

function finish() {
  incrementCounter();

  const threadId = process.env.OPENFLOW_FAKE_CODEX_THREAD_ID || "fake-thread";
  const usage = {
    input_tokens: Number(process.env.OPENFLOW_FAKE_CODEX_INPUT_TOKENS || "3"),
    cached_input_tokens: Number(process.env.OPENFLOW_FAKE_CODEX_CACHED_INPUT_TOKENS || "1"),
    output_tokens: Number(process.env.OPENFLOW_FAKE_CODEX_OUTPUT_TOKENS || "5"),
    reasoning_output_tokens: Number(process.env.OPENFLOW_FAKE_CODEX_REASONING_TOKENS || "2")
  };

  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: threadId }) + "\n");
  process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\n");

  if (process.env.OPENFLOW_FAKE_CODEX_FAIL === "1") {
    process.stdout.write(JSON.stringify({
      type: "turn.failed",
      error: { message: "fake codex failure" }
    }) + "\n");
    process.exitCode = 1;
    return;
  }

  const text = process.env.OPENFLOW_FAKE_CODEX_JSON === "1"
    ? JSON.stringify({ status: "ok", echo: stdin.trim().slice(0, 40) })
    : `fake:${stdin.trim()}`;
  process.stdout.write(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text }
  }) + "\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed", usage }) + "\n");
}

const delayMs = Number(process.env.OPENFLOW_FAKE_CODEX_DELAY_MS || "0");
process.stdin.on("end", () => {
  if (delayMs > 0) {
    setTimeout(finish, delayMs);
  } else {
    finish();
  }
});
