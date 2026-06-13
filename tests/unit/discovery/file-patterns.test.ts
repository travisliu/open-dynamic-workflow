import { describe, it, expect } from "vitest";
import { matchGlob, getGlobBaseDir } from "../../../src/discovery/file-patterns.js";

describe("file-patterns", () => {
  describe("matchGlob", () => {
    it("matches exact paths", () => {
      expect(matchGlob("a/b/c.ts", "a/b/c.ts")).toBe(true);
      expect(matchGlob("a/b/c.ts", "a/b/d.ts")).toBe(false);
    });

    it("matches with *", () => {
      expect(matchGlob("a/b/c.ts", "a/b/*.ts")).toBe(true);
      expect(matchGlob("a/b/d.js", "a/b/*.ts")).toBe(false);
      expect(matchGlob("a/b/c/d.ts", "a/b/*.ts")).toBe(false);
    });

    it("matches with **", () => {
      expect(matchGlob("a/b/c.ts", "**/*.ts")).toBe(true);
      expect(matchGlob("a/b/c/d.ts", "a/**/*.ts")).toBe(true);
      expect(matchGlob("a/b/c.js", "a/**/*.ts")).toBe(false);
    });

    it("handles ./ prefix in pattern", () => {
      expect(matchGlob("a/b/c.ts", "./a/b/*.ts")).toBe(true);
    });
  });

  describe("getGlobBaseDir", () => {
    it("extracts base dir before globs", () => {
      expect(getGlobBaseDir("a/b/*.ts")).toBe("a/b");
      expect(getGlobBaseDir("a/b/**/*.ts")).toBe("a/b");
      expect(getGlobBaseDir("**/*.ts")).toBe(".");
      expect(getGlobBaseDir("a/b/c.ts")).toBe("a/b/c.ts");
      expect(getGlobBaseDir("./a/b/*.ts")).toBe("a/b");
    });
  });
});
