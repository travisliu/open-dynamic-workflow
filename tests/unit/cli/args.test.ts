import { describe, expect, it } from "vitest";
import { parseKeyValueArgs, parsePositiveInteger, parseReportMode, parseNonNegativeInteger, parseRetryBackoff, parseRetryCliOptions } from "../../../src/cli/args.js";
import { OpenDynamicWorkflowError } from "../../../src/errors/types.js";
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
      expect(() => parseKeyValueArgs(["invalid_arg"])).toThrow(OpenDynamicWorkflowError);
      try {
        parseKeyValueArgs(["invalid_arg"]);
      } catch (err: any) {
        expect(err.code).toBe("CLI_USAGE_ERROR");
      }
    });

    it("throws CLI_USAGE_ERROR on empty key", () => {
      expect(() => parseKeyValueArgs(["=value"])).toThrow(OpenDynamicWorkflowError);
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
      expect(() => parsePositiveInteger("3.14", "--concurrency")).toThrow(OpenDynamicWorkflowError);
      expect(() => parsePositiveInteger("abc", "--concurrency")).toThrow(OpenDynamicWorkflowError);
    });

    it("throws CLI_USAGE_ERROR on non-positive integer", () => {
      expect(() => parsePositiveInteger("0", "--concurrency")).toThrow(OpenDynamicWorkflowError);
      expect(() => parsePositiveInteger("-5", "--concurrency")).toThrow(OpenDynamicWorkflowError);
    });
  });

  describe("parseReportMode", () => {
    it("parses valid report modes", () => {
      expect(parseReportMode("pretty")).toBe("pretty");
      expect(parseReportMode("json")).toBe("json");
      expect(parseReportMode("jsonl")).toBe("jsonl");
    });

    it("throws CLI_USAGE_ERROR on invalid report mode", () => {
      expect(() => parseReportMode("xml")).toThrow(OpenDynamicWorkflowError);
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
      program.parse(["node", "open-dynamic-workflow", "run", "workflow.js", "-v"], { from: "node" });
      const options = program.commands.find(c => c.name() === "run")?.opts();
      expect(options?.verbose).toBe(true);
    });

    it("parses --verbose as verbose mode", () => {
      const program = createProgram();
      program.parse(["node", "open-dynamic-workflow", "run", "workflow.js", "--verbose"], { from: "node" });
      const options = program.commands.find(c => c.name() === "run")?.opts();
      expect(options?.verbose).toBe(true);
    });

    it("defaults verbose to undefined or false when not provided", () => {
      const program = createProgram();
      program.parse(["node", "open-dynamic-workflow", "run", "workflow.js"], { from: "node" });
      const options = program.commands.find(c => c.name() === "run")?.opts();
      expect(options?.verbose).toBeFalsy();
    });
  });

  describe("parseNonNegativeInteger", () => {
    it("parses valid non-negative integer", () => {
      expect(parseNonNegativeInteger("0", "--retry-delay-ms")).toBe(0);
      expect(parseNonNegativeInteger("100", "--retry-delay-ms")).toBe(100);
    });

    it("throws CLI_USAGE_ERROR on non-integer or negative", () => {
      expect(() => parseNonNegativeInteger("3.14", "--retry-delay-ms")).toThrow(OpenDynamicWorkflowError);
      expect(() => parseNonNegativeInteger("-1", "--retry-delay-ms")).toThrow(OpenDynamicWorkflowError);
      expect(() => parseNonNegativeInteger("abc", "--retry-delay-ms")).toThrow(OpenDynamicWorkflowError);
    });
  });

  describe("parseRetryBackoff", () => {
    it("parses valid retry backoff values", () => {
      expect(parseRetryBackoff("fixed")).toBe("fixed");
      expect(parseRetryBackoff("exponential")).toBe("exponential");
    });

    it("throws CLI_USAGE_ERROR on invalid backoff value", () => {
      expect(() => parseRetryBackoff("linear")).toThrow(OpenDynamicWorkflowError);
    });
  });

  describe("parseRetryCliOptions", () => {
    it("parses valid combinations of retry flags", () => {
      // Arrange
      const rawOptions = {
        retryMaxAttempts: "5",
        retryDelayMs: "100",
        retryMaxDelayMs: "5000",
        retryBackoff: "exponential",
        retryDisableDelay: true,
      };

      // Act
      const parsed = parseRetryCliOptions(rawOptions);

      // Assert
      expect(parsed).toEqual({
        retryMaxAttempts: 5,
        retryDelayMs: 100,
        retryMaxDelayMs: 5000,
        retryBackoff: "exponential",
        retryDisableDelay: true,
      });
    });

    it("rejects malformed retry values with CLI_USAGE_ERROR", () => {
      // Arrange
      const invalidNumeric = { retryMaxAttempts: "abc" };
      const invalidBackoff = { retryBackoff: "linear" };

      // Act
      const parseNumeric = () => parseRetryCliOptions(invalidNumeric);
      const parseBackoff = () => parseRetryCliOptions(invalidBackoff);

      // Assert
      expect(parseNumeric).toThrow(OpenDynamicWorkflowError);
      expect(() => parseNumeric()).toThrow(expect.objectContaining({ code: "CLI_USAGE_ERROR" }));
      expect(parseBackoff).toThrow(OpenDynamicWorkflowError);
      expect(() => parseBackoff()).toThrow(expect.objectContaining({ code: "CLI_USAGE_ERROR" }));
    });

    it("captures --retry-disable-delay as a toggle", () => {
      // Arrange
      const rawOptions = { retryDisableDelay: true };

      // Act
      const parsed = parseRetryCliOptions(rawOptions);

      // Assert
      expect(parsed).toEqual({ retryDisableDelay: true });
    });

    it("rejects combinations that mix --no-retry with other retry flags", () => {
      // Arrange
      const rawOptions = {
        noRetry: true,
        retryDelayMs: "100"
      };

      // Act
      const parse = () => parseRetryCliOptions(rawOptions);

      // Assert
      expect(parse).toThrow(OpenDynamicWorkflowError);
      expect(() => parse()).toThrow(expect.objectContaining({ code: "CLI_USAGE_ERROR" }));
    });

    it("captures --no-retry as a disabled marker", () => {
      // Arrange
      const fromCommander = { retry: false };
      const fromBooleanToggle = { noRetry: true };

      // Act
      const parsedFromCommander = parseRetryCliOptions(fromCommander);
      const parsedFromBooleanToggle = parseRetryCliOptions(fromBooleanToggle);

      // Assert
      expect(parsedFromCommander).toEqual({ noRetry: true });
      expect(parsedFromBooleanToggle).toEqual({ noRetry: true });
    });
  });
});
