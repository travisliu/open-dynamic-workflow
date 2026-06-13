import { spawn } from "child_process";
import type { ProcessRunInput, ProcessRunResult } from "./types.js";

export function runProcess(input: ProcessRunInput): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const {
      command,
      args,
      cwd,
      stdin,
      env,
      timeoutMs,
      signal,
      onStdout,
      onStderr
    } = input;

    const startedAt = Date.now();
    let timedOut = false;
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;
    let resolved = false;

    // Accumulate stdout/stderr
    let stdoutAcc = "";
    let stderrAcc = "";

    // Track async output handlers to ensure they complete
    let stdoutChain = Promise.resolve();
    let stderrChain = Promise.resolve();

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const terminateProcess = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore
      }
      const graceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore
        }
      }, 2000);
      if (typeof graceTimer.unref === "function") {
        graceTimer.unref();
      }
    };

    const onAbort = () => {
      cancelled = true;
      cleanup();
      terminateProcess();
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        return reject(new Error("Process run aborted before spawning"));
      }
      signal.addEventListener("abort", onAbort);
    }

    if (timeoutMs > 0 && timeoutMs !== Infinity) {
      timer = setTimeout(() => {
        timedOut = true;
        cleanup();
        terminateProcess();
      }, timeoutMs);
    }

    child.on("error", (err) => {
      cleanup();
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdoutAcc += text;
      if (onStdout) {
        stdoutChain = stdoutChain.then(async () => {
          try {
            await onStdout(text);
          } catch {
            // Ignore callback errors
          }
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrAcc += text;
      if (onStderr) {
        stderrChain = stderrChain.then(async () => {
          try {
            await onStderr(text);
          } catch {
            // Ignore callback errors
          }
        });
      }
    });

    if (stdin !== undefined && stdin !== null) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on("close", async (exitCode, signalName) => {
      cleanup();
      
      // Wait for all output handlers to complete before resolving
      await Promise.allSettled([stdoutChain, stderrChain]);

      if (!resolved) {
        resolved = true;
        const durationMs = Date.now() - startedAt;
        resolve({
          exitCode,
          signal: signalName,
          stdout: stdoutAcc,
          stderr: stderrAcc,
          durationMs,
          timedOut,
          cancelled
        });
      }
    });
  });
}
