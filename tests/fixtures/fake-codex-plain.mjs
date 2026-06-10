import * as fs from "node:fs";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});

process.stdin.on("end", () => {
  const counterPath = process.env.OPENFLOW_FAKE_CODEX_COUNTER;
  if (counterPath) {
    const previous = fs.existsSync(counterPath)
      ? Number(fs.readFileSync(counterPath, "utf8") || "0")
      : 0;
    fs.writeFileSync(counterPath, String(previous + 1), "utf8");
  }

  process.stdout.write(JSON.stringify({ text: `fake:${stdin.trim()}` }));
});
