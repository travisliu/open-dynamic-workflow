import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { evaluateDiscoveryLoadPolicy } from "../../../src/discovery/policy.js";
import { checkDiscoveryPolicy, precollectResourceForLoad } from "../../../src/discovery/precollect.js";
import { collectResourceCandidateFiles } from "../../../src/discovery/collect-files.js";
import { ErrorCode } from "../../../src/errors/codes.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

// -----------------------------------------------------------------------------
// Pattern compilation tracking setup
// -----------------------------------------------------------------------------
let compileCount = 0;
vi.mock("../../../src/discovery/compile-patterns.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/discovery/compile-patterns.js")>();
  return {
    ...original,
    compileResourceDiscovery: (input: any) => {
      compileCount++;
      return original.compileResourceDiscovery(input);
    }
  };
});

describe("Discovery policy and precollection acceptance", () => {
  
  describe("policy evaluation and error-code mapping", () => {
    
    it("blocks strict discovery loads and maps violations to the expected error codes", async () => {
      // -----------------------------------------------------------------------
      // ARRANGE:
      // Setup mock diagnostic inputs & precollected resource structures.
      // We need a set of precollected structures that are clean,
      // and multiple diagnostic inputs representing:
      // - Fatal config error in strict context
      // - Symlink escape for shared agent
      // - Symlink escape for workflows/tools
      // -----------------------------------------------------------------------
      const mockPrecollected = {
        workflow: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        },
        sharedAgents: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        },
        tools: {
          loadInput: { candidateFiles: [], discoveryPolicy: { exclude: [] } },
          collectionResult: { files: [], diagnostics: [], configDiagnostics: [], metrics: [] }
        }
      };

      const fatalConfigDiag = [
        {
          code: "STRICT_FATAL_ERROR",
          message: "Fatal configuration error",
          severity: "error" as const,
          fatalInStrictContext: true,
        }
      ];

      const symlinkAgentDiag = [
        {
          code: "CONFIG_PATH_SYMLINK_ESCAPE",
          message: "Shared agent escape",
          severity: "error" as const,
          resource: "sharedAgents" as const,
          value: "agents/symlink",
          fatalInStrictContext: true,
        }
      ];

      const symlinkWorkflowDiag = [
        {
          code: "CONFIG_PATH_SYMLINK_ESCAPE",
          message: "Workflow symlink escape",
          severity: "error" as const,
          resource: "workflow" as const,
          value: "workflows/symlink",
          fatalInStrictContext: true,
        }
      ];

      const symlinkToolDiag = [
        {
          code: "CONFIG_PATH_SYMLINK_ESCAPE",
          message: "Tool symlink escape",
          severity: "error" as const,
          resource: "tools" as const,
          value: "tools/symlink",
          fatalInStrictContext: true,
        }
      ];

      // -----------------------------------------------------------------------
      // ACT & ASSERT:
      // Invoke evaluateDiscoveryLoadPolicy() and checkDiscoveryPolicy()
      // under various contexts (strict vs non-strict) and assert correct behaviors.
      // -----------------------------------------------------------------------

      // --- Assertion A: evaluateDiscoveryLoadPolicy blocks strict contexts ---
      const strictDecision = evaluateDiscoveryLoadPolicy({
        context: "run-strict",
        rawResult: {
          schemaVersion: "open-dynamic-workflow.list.v1",
          resourceTypes: ["workflow"],
          resources: [],
          warnings: [],
          errors: [],
          configDiagnostics: [],
          summary: { discoveredCount: 0, validCount: 0, warningCount: 0, errorCount: 0, configWarningCount: 0, configErrorCount: 0, countsByType: { workflow: 0, agent: 0, tool: 0 } }
        },
        configDiagnostics: fatalConfigDiag
      });
      expect(strictDecision.shouldBlockLoad).toBe(true);

      const nonStrictDecision = evaluateDiscoveryLoadPolicy({
        context: "list",
        rawResult: {
          schemaVersion: "open-dynamic-workflow.list.v1",
          resourceTypes: ["workflow"],
          resources: [],
          warnings: [],
          errors: [],
          configDiagnostics: [],
          summary: { discoveredCount: 0, validCount: 0, warningCount: 0, errorCount: 0, configWarningCount: 0, configErrorCount: 0, countsByType: { workflow: 0, agent: 0, tool: 0 } }
        },
        configDiagnostics: fatalConfigDiag
      });
      expect(nonStrictDecision.shouldBlockLoad).toBe(false);

      // --- Assertion B: checkDiscoveryPolicy throws OpenDynamicWorkflowError with correct error codes ---
      
      // B.1: Shared Agent Symlink Escape maps to SHARED_AGENT_SECURITY_POLICY_VIOLATION
      await expect(
        checkDiscoveryPolicy("run-strict", symlinkAgentDiag, mockPrecollected, "/mock-cwd")
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.SHARED_AGENT_SECURITY_POLICY_VIOLATION,
          message: expect.stringContaining("Shared agent symlink")
        })
      );

      // B.2: Workflow Symlink Escape maps to SECURITY_POLICY_VIOLATION
      await expect(
        checkDiscoveryPolicy("run-strict", symlinkWorkflowDiag, mockPrecollected, "/mock-cwd")
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.SECURITY_POLICY_VIOLATION,
          message: expect.stringContaining("Workflow file outside project root")
        })
      );

      // B.3: Tool Symlink Escape maps to SECURITY_POLICY_VIOLATION
      await expect(
        checkDiscoveryPolicy("run-strict", symlinkToolDiag, mockPrecollected, "/mock-cwd")
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.SECURITY_POLICY_VIOLATION,
          message: expect.stringContaining("Workflow file outside project root")
        })
      );

      // B.4: Other strict context violations map to WORKFLOW_DISCOVERY_FAILED
      await expect(
        checkDiscoveryPolicy("run-strict", fatalConfigDiag, mockPrecollected, "/mock-cwd")
      ).rejects.toThrowError(
        expect.objectContaining({
          code: ErrorCode.WORKFLOW_DISCOVERY_FAILED,
          message: expect.stringContaining("Discovery policy blocked loading")
        })
      );

      // --- Assertion C: Non-strict contexts do not throw ---
      await expect(
        checkDiscoveryPolicy("list", fatalConfigDiag, mockPrecollected, "/mock-cwd")
      ).resolves.toBeUndefined();

      await expect(
        checkDiscoveryPolicy("list", symlinkAgentDiag, mockPrecollected, "/mock-cwd")
      ).resolves.toBeUndefined();
    });
  });

  describe("precollection and compatibility behavior", () => {
    let tempDir: string;
    let outsideDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(tmpdir(), "aaa-workspace-"));
      outsideDir = fs.mkdtempSync(path.join(tmpdir(), "aaa-outside-"));
      compileCount = 0;
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it("precollects workflow candidates, excludes blocked paths, and preserves wrapper compatibility", async () => {
      // -----------------------------------------------------------------------
      // ARRANGE:
      // Create temporary workspaces containing accepted files, excluded files,
      // and out-of-workspace symlinks.
      // -----------------------------------------------------------------------
      
      // 1. Set up directories
      const workflowDir = path.join(tempDir, "workflows");
      fs.mkdirSync(workflowDir, { recursive: true });

      // 2. Set up accepted file
      const acceptedFile = path.join(workflowDir, "accepted.js");
      fs.writeFileSync(acceptedFile, "console.log('accepted')");

      // 3. Set up excluded file
      const excludedFile = path.join(workflowDir, "excluded.js");
      fs.writeFileSync(excludedFile, "console.log('excluded')");

      // 4. Set up outside file and safe/unsafe symlinks
      const outsideFile = path.join(outsideDir, "unsafe.js");
      fs.writeFileSync(outsideFile, "console.log('unsafe outside')");

      const unsafeSymlink = path.join(workflowDir, "unsafe-symlink.js");
      
      let symlinkCreated = false;
      try {
        fs.symlinkSync(outsideFile, unsafeSymlink);
        symlinkCreated = true;
      } catch {
        // Guard for platforms/filesystems where symlinks are not permitted.
      }

      // 5. Define discovery config
      const discoveryConfig = {
        resource: "workflow",
        include: ["workflows/**/*.js"],
        exclude: ["workflows/excluded.js"],
        source: "project-config",
        includeSource: "project-config",
        excludeSource: "project-config",
        compatibilityMode: "default-suffix-specific",
        sourcePaths: [],
        rawInclude: ["workflows/**/*.js"],
        rawExclude: ["workflows/excluded.js"],
        diagnostics: [],
      } as any;

      // -----------------------------------------------------------------------
      // ACT:
      // Invoke precollectResourceForLoad() and collectResourceCandidateFiles()
      // -----------------------------------------------------------------------
      const precollectResult = await precollectResourceForLoad({
        cwd: tempDir,
        resourceType: "workflow",
        discovery: discoveryConfig,
        strict: true
      });

      // Verify candidate selection compiles discovery once (reusing exclude)
      expect(compileCount).toBe(1);

      const wrapperResult = await collectResourceCandidateFiles({
        cwd: tempDir,
        resourceType: "workflow",
        include: ["workflows/**/*.js"],
        exclude: ["workflows/excluded.js"],
        compatibilityMode: "default-suffix-specific",
        strict: true
      });

      // -----------------------------------------------------------------------
      // ASSERT:
      // Verify compiled patterns, exclude reuse, diagnostics preservation,
      // escape blocking and legacy wrapper compatibility.
      // -----------------------------------------------------------------------

      // 1. Verify loadInput.discoveryPolicy.exclude matches compiled exclude array
      expect(precollectResult.loadInput.discoveryPolicy.exclude).toBeDefined();
      expect(precollectResult.loadInput.discoveryPolicy.exclude.length).toBe(1);
      expect(precollectResult.loadInput.discoveryPolicy.exclude[0].absoluteBaseDir).toBe(
        path.resolve(tempDir, "workflows/excluded.js")
      );

      // 3. Verify files list: accepted.js is included, excluded.js is NOT included.
      const candidatePaths = precollectResult.loadInput.candidateFiles.map(f => f.relativePath);
      expect(candidatePaths).toContain("workflows/accepted.js");
      expect(candidatePaths).not.toContain("workflows/excluded.js");

      // 4. Verify list diagnostics (like LIST_DIRECTORY_NOT_FOUND) are preserved.
      const missingDiscovery = {
        ...discoveryConfig,
        include: ["missing-directory/**/*.js"]
      };
      const missingResult = await precollectResourceForLoad({
        cwd: tempDir,
        resourceType: "workflow",
        discovery: missingDiscovery,
        strict: true
      });
      const hasDirNotFound = missingResult.collectionResult.diagnostics.some(
        d => d.code === "LIST_DIRECTORY_NOT_FOUND"
      );
      expect(hasDirNotFound).toBe(true);

      // 5. Verify unsafe symlinks are blocked with CONFIG_PATH_SYMLINK_ESCAPE
      if (symlinkCreated) {
        expect(candidatePaths).not.toContain("workflows/unsafe-symlink.js");

        const hasEscapeDiag = precollectResult.collectionResult.configDiagnostics.some(
          d => d.code === "CONFIG_PATH_SYMLINK_ESCAPE"
        );
        expect(hasEscapeDiag).toBe(true);
      }

      // 6. Verify legacy wrapper compatibility works
      expect(wrapperResult.files).toBeDefined();
      expect(wrapperResult.diagnostics).toBeDefined();
      expect(wrapperResult.configDiagnostics).toBeDefined();
      const wrapperPaths = wrapperResult.files.map(f => f.relativePath);
      expect(wrapperPaths).toContain("workflows/accepted.js");
      expect(wrapperPaths).not.toContain("workflows/excluded.js");
    });
  });
});
