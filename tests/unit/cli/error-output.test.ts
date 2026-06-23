import { describe, expect, it } from "vitest";
import { renderCliError } from "../../../src/cli/error-output.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
import { ErrorCode } from "../../../src/errors/codes.js";

class MemoryStream {
  content = "";
  write(chunk: any): boolean {
    this.content += chunk.toString();
    return true;
  }
}

describe("CLI Error Output Helper", () => {
  it("pretty mode writes the original error to stderr", () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const error = new Error("Something went wrong");

    renderCliError(error, {
      argv: ["node", "open-dynamic-workflow", "validate", "workflow"],
      streams: { stdout, stderr },
    });

    expect(stderr.content).toBe("Something went wrong\n");
    expect(stdout.content).toBe("");
  });

  it("pretty mode appends one Hint: line when error.hint exists", () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const error = new Error("Something went wrong") as any;
    error.hint = {
      code: "PROJECT_INIT_MISSING",
      message: "This project may not be initialized yet. Run `odw init` to create .open-dynamic-workflow/config.yaml and default project directories.",
      command: "odw init",
    };

    renderCliError(error, {
      argv: ["node", "open-dynamic-workflow", "validate", "workflow"],
      streams: { stdout, stderr },
    });

    expect(stderr.content).toBe(
      "Something went wrong\nHint: This project may not be initialized yet. Run `odw init` to create .open-dynamic-workflow/config.yaml and default project directories.\n"
    );
    expect(stdout.content).toBe("");
  });

  it("pretty mode does not print a hint when none exists", () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const error = new Error("Something went wrong");

    renderCliError(error, {
      argv: ["node", "open-dynamic-workflow", "validate", "workflow"],
      streams: { stdout, stderr },
    });

    expect(stderr.content).not.toContain("Hint:");
  });

  it("JSON mode writes exactly one parseable object to stdout", () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const error = new OpenDynamicWorkflowError(ErrorCode.SHARED_AGENT_NOT_FOUND, "Preflight failed") as any;
    error.hint = {
      code: "PROJECT_INIT_MISSING",
      message: "Please init",
      command: "odw init",
    };

    renderCliError(error, {
      argv: ["node", "open-dynamic-workflow", "run", "workflow", "--report", "json"],
      streams: { stdout, stderr },
    });

    expect(stderr.content).toBe("");
    const parsed = JSON.parse(stdout.content.trim());
    expect(parsed.schemaVersion).toBe("open-dynamic-workflow.error.v1");
    expect(parsed.status).toBe("failed");
    expect(parsed.error.name).toBe("OpenDynamicWorkflowError");
    expect(parsed.error.message).toBe("Preflight failed");
    expect(parsed.error.code).toBe("SHARED_AGENT_NOT_FOUND");
    expect(parsed.error.hint).toEqual({
      code: "PROJECT_INIT_MISSING",
      message: "Please init",
      command: "odw init",
    });
    expect(typeof parsed.error.stack).toBe("string");
  });

  it("JSONL mode writes exactly one parseable line to stdout", () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const error = new OpenDynamicWorkflowError(ErrorCode.SHARED_AGENT_NOT_FOUND, "Preflight failed") as any;
    error.hint = {
      code: "PROJECT_INIT_MISSING",
      message: "Please init",
      command: "odw init",
    };

    renderCliError(error, {
      argv: ["node", "open-dynamic-workflow", "run", "workflow", "--report", "jsonl"],
      streams: { stdout, stderr },
    });

    expect(stderr.content).toBe("");
    const lines = stdout.content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.schemaVersion).toBe("open-dynamic-workflow.error.v1");
    expect(parsed.type).toBe("cli.error");
    expect(parsed.error.name).toBe("OpenDynamicWorkflowError");
    expect(parsed.error.message).toBe("Preflight failed");
    expect(parsed.error.code).toBe("SHARED_AGENT_NOT_FOUND");
    expect(parsed.error.hint).toEqual({
      code: "PROJECT_INIT_MISSING",
      message: "Please init",
      command: "odw init",
    });
    expect(typeof parsed.error.stack).toBe("string");
  });

  it("JSON and JSONL modes do not leak human-readable text to stdout", () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const error = new Error("Preflight failed");

    renderCliError(error, {
      argv: ["node", "open-dynamic-workflow", "run", "workflow", "--report", "json"],
      streams: { stdout, stderr },
    });

    // It should be pure parseable JSON, no prefix/suffix
    expect(stdout.content.trim().startsWith("{")).toBe(true);
    expect(stdout.content.trim().endsWith("}")).toBe(true);
  });
});
