import { describe, expect, it, afterAll, beforeAll } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  normalizePatternPath,
  detectUnsupportedGlobSyntax,
  normalizePatternForMatching,
  isPathInsideCwd,
  checkRealPathInsideCwd,
  checkMatchedFileSafety,
} from "../../../src/config/path-safety.js";

describe("Path Safety Helpers", () => {
  let tempDir: string;
  let workspaceDir: string;
  let symlinksSupported = true;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "path-safety-test-"));
    // Create a mock workspace directory inside the temp directory
    workspaceDir = path.join(tempDir, "workspace");
    fs.mkdirSync(workspaceDir);

    try {
      const testLink = path.join(tempDir, "test-symlink-support");
      fs.symlinkSync("target", testLink);
      fs.unlinkSync(testLink);
    } catch (e) {
      symlinksSupported = false;
    }
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("normalizePatternPath", () => {
    it("converts backslashes to /", () => {
      expect(normalizePatternPath("foo\\bar\\baz")).toBe("foo/bar/baz");
      expect(normalizePatternPath("foo\\\\bar")).toBe("foo/bar");
    });

    it("removes leading ./", () => {
      expect(normalizePatternPath("./foo/bar")).toBe("foo/bar");
      expect(normalizePatternPath("././foo")).toBe("foo");
    });

    it("keeps relative patterns relative", () => {
      expect(normalizePatternPath("../outside/foo")).toBe("../outside/foo");
      expect(normalizePatternPath("foo/bar")).toBe("foo/bar");
    });
  });

  describe("detectUnsupportedGlobSyntax", () => {
    it("detects expected labels", () => {
      expect(detectUnsupportedGlobSyntax("{a,b}")).toContain("brace-expansion");
      expect(detectUnsupportedGlobSyntax("[a-z]")).toContain("character-class");
      expect(detectUnsupportedGlobSyntax("?(abc)")).toContain("extglob");
      expect(detectUnsupportedGlobSyntax("!(abc)")).toContain("extglob");
      expect(detectUnsupportedGlobSyntax("+(abc)")).toContain("extglob");
      expect(detectUnsupportedGlobSyntax("@(abc)")).toContain("extglob");
      expect(detectUnsupportedGlobSyntax("!foo")).toContain("negated-pattern");
      expect(detectUnsupportedGlobSyntax("foo/!bar")).toContain("negated-pattern");
      expect(detectUnsupportedGlobSyntax("foo?bar")).toContain("question-mark");
      expect(detectUnsupportedGlobSyntax("?")).toContain("question-mark");

      // Check multiple labels
      const multiple = detectUnsupportedGlobSyntax("!(abc)?foo/!bar");
      expect(multiple).toContain("extglob");
      expect(multiple).toContain("question-mark");
      expect(multiple).toContain("negated-pattern");

      // Check standard wildcards are not labeled as unsupported
      expect(detectUnsupportedGlobSyntax("**/foo/*.js")).toEqual([]);
    });
  });

  describe("isPathInsideCwd", () => {
    it("returns true for in-workspace paths", () => {
      expect(isPathInsideCwd({ cwd: "/workspace", targetPath: "/workspace/foo" })).toBe(true);
      expect(isPathInsideCwd({ cwd: "/workspace", targetPath: "foo" })).toBe(true);
      expect(isPathInsideCwd({ cwd: "/workspace", targetPath: "/workspace" })).toBe(true);
    });

    it("returns false for out-of-workspace paths", () => {
      expect(isPathInsideCwd({ cwd: "/workspace", targetPath: "/outside" })).toBe(false);
      expect(isPathInsideCwd({ cwd: "/workspace", targetPath: "../outside" })).toBe(false);
    });
  });

  describe("normalizePatternForMatching", () => {
    it("rejects empty and whitespace-only patterns", () => {
      const res1 = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: "",
        source: "new",
      });
      expect(res1.pattern).toBeUndefined();
      expect(res1.diagnostics[0].code).toBe("CONFIG_PATH_EMPTY_PATTERN");

      const res2 = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: "   ",
        source: "new",
      });
      expect(res2.pattern).toBeUndefined();
      expect(res2.diagnostics[0].code).toBe("CONFIG_PATH_EMPTY_PATTERN");
    });

    it("rejects directory-only values (trailing slash)", () => {
      const res = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: "foo/",
        source: "new",
      });
      expect(res.pattern).toBeUndefined();
      expect(res.diagnostics[0].code).toBe("CONFIG_PATH_DIRECTORY_ONLY");
    });

    it("warns about unsupported glob syntax but returns the normalized pattern", () => {
      const res = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: "foo/{bar,baz}/*.js",
        source: "new",
      });
      expect(res.pattern).toBe("foo/{bar,baz}/*.js");
      expect(res.diagnostics[0].code).toBe("CONFIG_PATH_UNSUPPORTED_GLOB_SYNTAX");
      expect(res.diagnostics[0].severity).toBe("warning");
      expect(res.diagnostics[0].fatalInStrictContext).toBe(false);
    });

    it("rejects absolute config patterns (even if inside cwd) when not cli-override", () => {
      const insideAbs = path.join(workspaceDir, "foo");
      const res = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: insideAbs,
        source: "new",
      });
      expect(res.pattern).toBeUndefined();
      expect(res.diagnostics[0].code).toBe("CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN");
    });

    it("rejects absolute config patterns outside cwd", () => {
      const outsideAbs = path.join(tempDir, "outside");
      const res = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: outsideAbs,
        source: "new",
      });
      expect(res.pattern).toBeUndefined();
      expect(res.diagnostics[0].code).toBe("CONFIG_PATH_ABSOLUTE_CONFIG_PATTERN");
    });

    it("normalizes CLI override absolute paths inside cwd to relative", () => {
      const insideAbs = path.join(workspaceDir, "foo", "bar");
      const res = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: insideAbs,
        source: "cli-override",
      });
      expect(res.pattern).toBe("foo/bar");
      expect(res.diagnostics[0].code).toBe("CONFIG_PATH_CLI_OVERRIDE_USED");
      expect(res.diagnostics[0].severity).toBe("warning");
      expect(res.diagnostics[0].fatalInStrictContext).toBe(false);
    });

    it("rejects CLI override absolute paths outside cwd", () => {
      const outsideAbs = path.join(tempDir, "outside");
      const res = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: outsideAbs,
        source: "cli-override",
      });
      expect(res.pattern).toBeUndefined();
      expect(res.diagnostics[0].code).toBe("CONFIG_PATH_OUTSIDE_WORKSPACE");
    });

    it("rejects relative patterns escaping cwd via ..", () => {
      const res = normalizePatternForMatching({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        pattern: "../outside/**/*.js",
        source: "new",
      });
      expect(res.pattern).toBeUndefined();
      expect(res.diagnostics[0].code).toBe("CONFIG_PATH_OUTSIDE_WORKSPACE");
    });
  });

  describe("RealPath safety tests", () => {
    it("checkRealPathInsideCwd returns realPath when inside cwd", async () => {
      const fileInside = path.join(workspaceDir, "file.js");
      fs.writeFileSync(fileInside, "content");
      const res = await checkRealPathInsideCwd({
        cwd: workspaceDir,
        targetPath: "file.js",
        resource: "workflow",
        path: "workflow.include[0]",
        source: "new",
      });
      expect(res.realPath).toBe(fs.realpathSync(fileInside));
      expect(res.diagnostics).toEqual([]);
    });

    it("checkRealPathInsideCwd returns symlink escape diagnostic when target escapes", async () => {
      if (!symlinksSupported) {
        return;
      }

      // Create a file outside workspace
      const fileOutside = path.join(tempDir, "outside-file.js");
      fs.writeFileSync(fileOutside, "content");

      // Create symlink inside workspace pointing to the outside file
      const linkInside = path.join(workspaceDir, "link-outside.js");
      fs.symlinkSync(fileOutside, linkInside);

      const res = await checkRealPathInsideCwd({
        cwd: workspaceDir,
        targetPath: "link-outside.js",
        resource: "workflow",
        path: "workflow.include[0]",
        source: "new",
      });

      expect(res.realPath).toBeUndefined();
      expect(res.diagnostics[0].code).toBe("CONFIG_PATH_SYMLINK_ESCAPE");
    });

    it("checkMatchedFileSafety checks files escaping and inside cwd", async () => {
      const fileInside = path.join(workspaceDir, "matched.js");
      fs.writeFileSync(fileInside, "content");

      const resInside = await checkMatchedFileSafety({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        filePath: "matched.js",
        source: "new",
      });
      expect(resInside.realPath).toBe(fs.realpathSync(fileInside));
      expect(resInside.relativePath).toBe("matched.js");
      expect(resInside.diagnostics).toEqual([]);

      if (!symlinksSupported) {
        return;
      }

      // Symlink escaping cwd
      const fileOutside = path.join(tempDir, "outside-matched.js");
      fs.writeFileSync(fileOutside, "content");
      const linkInside = path.join(workspaceDir, "link-outside-matched.js");
      fs.symlinkSync(fileOutside, linkInside);

      const resOutside = await checkMatchedFileSafety({
        cwd: workspaceDir,
        resource: "workflow",
        path: "workflow.include[0]",
        filePath: "link-outside-matched.js",
        source: "new",
      });

      expect(resOutside.realPath).toBeUndefined();
      expect(resOutside.relativePath).toBeUndefined();
      expect(resOutside.diagnostics[0].code).toBe("CONFIG_PATH_SYMLINK_ESCAPE");
    });
  });
});
