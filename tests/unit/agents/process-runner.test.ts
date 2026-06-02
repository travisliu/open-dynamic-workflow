import { describe, expect, it } from "vitest";
import { runProcess } from "../../../src/agents/process-runner.js";

describe("ProcessRunner", () => {
  it("captures stdout", async () => {
    const result = await runProcess({
      command: "node",
      args: ["-e", "console.log('hello world')"],
      cwd: process.cwd(),
      timeoutMs: 5000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
  });

  it("captures stderr", async () => {
    const result = await runProcess({
      command: "node",
      args: ["-e", "console.error('error log')"],
      cwd: process.cwd(),
      timeoutMs: 5000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("error log");
  });

  it("returns non-zero exit code and does not throw", async () => {
    const result = await runProcess({
      command: "node",
      args: ["-e", "process.exit(42)"],
      cwd: process.cwd(),
      timeoutMs: 5000
    });

    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
  });

  it("passes stdin", async () => {
    const result = await runProcess({
      command: "node",
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      cwd: process.cwd(),
      stdin: "input from stdin",
      timeoutMs: 5000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("input from stdin");
  });

  it("times out long-running process", async () => {
    const result = await runProcess({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: process.cwd(),
      timeoutMs: 100 // short timeout
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("handles abort signal", async () => {
    const controller = new AbortController();
    const runPromise = runProcess({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal: controller.signal
    });

    setTimeout(() => {
      controller.abort();
    }, 100);

    const result = await runPromise;
    expect(result.cancelled).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("reports duration", async () => {
    const result = await runProcess({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 50)"],
      cwd: process.cwd(),
      timeoutMs: 5000
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(40);
  });

  it("throws clear error when command is missing", async () => {
    await expect(
      runProcess({
        command: "this-command-does-not-exist-xyz-123",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 5000
      })
    ).rejects.toThrow();
  });

  it("waits for async output handlers", async () => {
    let outputHandled = false;
    const result = await runProcess({
      command: "node",
      args: ["-e", "console.log('test')"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      onStdout: async () => {
        await new Promise(r => setTimeout(r, 100));
        outputHandled = true;
      }
    });

    expect(result.exitCode).toBe(0);
    expect(outputHandled).toBe(true);
  });
});
