import { describe, expect, it } from "vitest";
import { parseKeyValueArgs, parsePositiveInteger, parseReportMode } from "../../../src/cli/args.js";
import { OpenFlowError } from "../../../src/errors/types.js";
import { Command } from "commander";

describe("CLI Options Parsing Helpers", () => {
  describe("parseKeyValueArgs", () => {
    it("parses valid key-value pairs", () => {
      const result = parseKeyValueArgs(["foo=bar", "x=y=z"]);
      expect(result).toEqual({ foo: "bar", x: "y=z" });
    });

    it("handles empty input", () => {
      const result = parseKeyValueArgs([]);
      expect(result).toEqual({});
    });

    it("throws CLI_USAGE_ERROR on invalid format without '='", () => {
      expect(() => parseKeyValueArgs(["invalid_arg"])).toThrow(OpenFlowError);
      try {
        parseKeyValueArgs(["invalid_arg"]);
      } catch (err: any) {
        expect(err.code).toBe("CLI_USAGE_ERROR");
      }
    });

    it("throws CLI_USAGE_ERROR on empty key", () => {
      expect(() => parseKeyValueArgs(["=value"])).toThrow(OpenFlowError);
      try {
        parseKeyValueArgs(["=value"]);
      } catch (err: any) {
        expect(err.code).toBe("CLI_USAGE_ERROR");
      }
    });
  });

  describe("parsePositiveInteger", () => {
    it("parses valid positive integer", () => {
      expect(parsePositiveInteger("10", "--concurrency")).toBe(10);
      expect(parsePositiveInteger("42", "--timeout-ms")).toBe(42);
    });

    it("throws CLI_USAGE_ERROR on non-integer", () => {
      expect(() => parsePositiveInteger("3.14", "--concurrency")).toThrow(OpenFlowError);
      expect(() => parsePositiveInteger("abc", "--concurrency")).toThrow(OpenFlowError);
    });

    it("throws CLI_USAGE_ERROR on non-positive integer", () => {
      expect(() => parsePositiveInteger("0", "--concurrency")).toThrow(OpenFlowError);
      expect(() => parsePositiveInteger("-5", "--concurrency")).toThrow(OpenFlowError);
    });
  });

  describe("parseReportMode", () => {
    it("parses valid report modes", () => {
      expect(parseReportMode("pretty")).toBe("pretty");
      expect(parseReportMode("json")).toBe("json");
      expect(parseReportMode("jsonl")).toBe("jsonl");
    });

    it("throws CLI_USAGE_ERROR on invalid report mode", () => {
      expect(() => parseReportMode("xml")).toThrow(OpenFlowError);
      try {
        parseReportMode("xml");
      } catch (err: any) {
        expect(err.code).toBe("CLI_USAGE_ERROR");
      }
    });
  });

  describe("Verbose flag parsing", () => {
    const createProgram = () => {
      const program = new Command();
      program
        .command("run")
        .argument("<workflow-file>", "Path to workflow file")
        .option("-v, --verbose", "Enable verbose logging")
        .action(() => {});
      return program;
    };

    it("parses -v as verbose mode", () => {
      const program = createProgram();
      program.parse(["node", "openflow", "run", "workflow.js", "-v"], { from: "node" });
      const options = program.commands.find(c => c.name() === "run")?.opts();
      expect(options?.verbose).toBe(true);
    });

    it("parses --verbose as verbose mode", () => {
      const program = createProgram();
      program.parse(["node", "openflow", "run", "workflow.js", "--verbose"], { from: "node" });
      const options = program.commands.find(c => c.name() === "run")?.opts();
      expect(options?.verbose).toBe(true);
    });

    it("defaults verbose to undefined or false when not provided", () => {
      const program = createProgram();
      program.parse(["node", "openflow", "run", "workflow.js"], { from: "node" });
      const options = program.commands.find(c => c.name() === "run")?.opts();
      expect(options?.verbose).toBeFalsy();
    });
  });
});
