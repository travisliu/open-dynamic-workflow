import { describe, expect, it } from "vitest";
import { ErrorCode } from "../../../src/errors/codes.js";
import { isAncestorPath, joinContextPath, parseContextPath } from "../../../src/context/path.js";

function expectPathValidationError(fn: () => unknown, message: string) {
  expect(fn).toThrow(
    expect.objectContaining({
      code: ErrorCode.CONTEXT_INVALID_PATH,
      message: expect.stringContaining(message),
    })
  );
}

describe("Workflow Context Path Validation", () => {
  describe("parseContextPath", () => {
    it("parses valid nested paths into normalized segments", () => {
      // Arrange
      const p1 = parseContextPath("workflow.constraints", { operation: "get" });

      // Assert
      expect(p1.raw).toBe("workflow.constraints");
      expect(p1.normalized).toBe("workflow.constraints");
      expect(p1.segments).toEqual(["workflow", "constraints"]);

      // Act
      const p2 = parseContextPath("features.auth.plan.goal", { operation: "set" });

      // Assert
      expect(p2.raw).toBe("features.auth.plan.goal");
      expect(p2.normalized).toBe("features.auth.plan.goal");
      expect(p2.segments).toEqual(["features", "auth", "plan", "goal"]);
    });

    it("trims valid surrounding whitespace without repairing malformed paths", () => {
      // Arrange
      const p = parseContextPath("  workflow . constraints   ", { operation: "get" });

      // Assert
      expect(p.raw).toBe("  workflow . constraints   ");
      expect(p.normalized).toBe("workflow.constraints");
      expect(p.segments).toEqual(["workflow", "constraints"]);
    });

    it("rejects non-string inputs", () => {
      // Arrange
      const input = 123 as any;

      // Act / Assert
      expectPathValidationError(() => parseContextPath(input, { operation: "get" }), "Path must be a string");
    });

    it("rejects empty and whitespace-only paths", () => {
      // Arrange
      const emptyPath = "";
      const whitespacePath = "   ";

      // Act / Assert
      expectPathValidationError(() => parseContextPath(emptyPath, { operation: "get" }), "Path cannot be empty");
      expectPathValidationError(() => parseContextPath(whitespacePath, { operation: "get" }), "Path cannot be empty");
    });

    it("rejects paths with leading or trailing dots", () => {
      // Arrange
      const leadingDot = ".workflow";
      const trailingDot = "workflow.";

      // Act / Assert
      expectPathValidationError(() => parseContextPath(leadingDot, { operation: "get" }), "Path cannot start with a dot");
      expectPathValidationError(() => parseContextPath(trailingDot, { operation: "get" }), "Path cannot end with a dot");
    });

    it("rejects empty or whitespace-only segments within the path", () => {
      // Arrange
      const malformedPath = "workflow.  .constraints";

      // Act / Assert
      expectPathValidationError(() => parseContextPath(malformedPath, { operation: "get" }), "Path contains empty segments");
    });

    it("rejects path traversal segments", () => {
      // Arrange
      const directTraversal = "workflow..constraints";
      const nestedTraversal = "workflow.sub...constraints";

      // Act / Assert
      expectPathValidationError(
        () => parseContextPath(directTraversal, { operation: "get" }),
        "Path traversal segments (..) are not allowed"
      );
      expectPathValidationError(
        () => parseContextPath(nestedTraversal, { operation: "get" }),
        "Path traversal segments (..) are not allowed"
      );
    });

    it("rejects purely numeric segments", () => {
      // Arrange
      const nestedNumeric = "workflow.0.constraints";
      const rootNumeric = "123";

      // Act / Assert
      expectPathValidationError(
        () => parseContextPath(nestedNumeric, { operation: "get" }),
        "Numeric path segments are not allowed"
      );
      expectPathValidationError(() => parseContextPath(rootNumeric, { operation: "get" }), "Numeric path segments are not allowed");
    });

    it("rejects prototype pollution segments", () => {
      // Arrange
      const forbidden = ["__proto__", "prototype", "constructor"];

      // Act / Assert
      for (const seg of forbidden) {
        expectPathValidationError(
          () => parseContextPath(`workflow.${seg}.constraints`, { operation: "get" }),
          "Prototype pollution segments are not allowed"
        );
      }
    });
  });

  describe("joinContextPath", () => {
    it("joins prefix and path correctly and validates the output", () => {
      // Arrange
      const j1 = joinContextPath("workflow", "constraints", { operation: "set" });

      // Assert
      expect(j1.normalized).toBe("workflow.constraints");

      // Act
      const j2 = joinContextPath("", "constraints", { operation: "set" });

      // Assert
      expect(j2.normalized).toBe("constraints");

      // Act
      const j3 = joinContextPath("workflow", "", { operation: "set" });

      // Assert
      expect(j3.normalized).toBe("workflow");
    });

    it("rejects invalid joined paths", () => {
      // Arrange
      const prefix = "workflow";
      const path = "0";

      // Act / Assert
      expectPathValidationError(
        () => joinContextPath(prefix, path, { operation: "set" }),
        "Numeric path segments are not allowed"
      );
    });
  });

  describe("isAncestorPath", () => {
    it("returns true for ancestor paths", () => {
      expect(isAncestorPath("a.b", "a.b.c")).toBe(true);
      expect(isAncestorPath("a", "a.b.c")).toBe(true);
    });

    it("returns false for unrelated or sibling paths", () => {
      expect(isAncestorPath("a.b", "a.b")).toBe(false);
      expect(isAncestorPath("a.b", "a.bc")).toBe(false);
      expect(isAncestorPath("a.b", "a.bc.d")).toBe(false);
      expect(isAncestorPath("a.b.c", "a.b")).toBe(false);
    });
  });
});
