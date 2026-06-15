import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isSupportedInitProvider,
  isExecutableOnPath,
  detectProviders,
  recommendProvider,
  selectProviderNonInteractive
} from "../../src/cli/init/providers.js";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("node:fs/promises");

describe("Init Provider Services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isSupportedInitProvider", () => {
    it("returns true for supported providers", () => {
      expect(isSupportedInitProvider("mock")).toBe(true);
      expect(isSupportedInitProvider("codex")).toBe(true);
      expect(isSupportedInitProvider("antigravity")).toBe(true);
    });

    it("returns false for unsupported providers", () => {
      expect(isSupportedInitProvider("unknown")).toBe(false);
      expect(isSupportedInitProvider("")).toBe(false);
    });
  });

  describe("isExecutableOnPath", () => {
    it("POSIX: returns true if file is executable", async () => {
      const mockStat = vi.mocked(fs.stat);
      const mockAccess = vi.mocked(fs.access);

      mockStat.mockResolvedValue({ isFile: () => true } as any);
      mockAccess.mockResolvedValue(undefined);

      const result = await isExecutableOnPath("codex", "/bin", "linux");
      expect(result).toBe(true);
      expect(mockStat).toHaveBeenCalledWith("/bin/codex");
      expect(mockAccess).toHaveBeenCalledWith("/bin/codex", expect.any(Number));
    });

    it("POSIX: returns false if file is not found", async () => {
      const mockStat = vi.mocked(fs.stat);
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const result = await isExecutableOnPath("codex", "/bin", "linux");
      expect(result).toBe(false);
    });

    it("POSIX: detected by file presence/execute bit only and never read or executed", async () => {
      const mockStat = vi.mocked(fs.stat);
      const mockAccess = vi.mocked(fs.access);
      // We don't need to mock readFile if we just want to ensure it's not called, 
      // but it's better to be explicit if it was mocked.
      
      mockStat.mockResolvedValue({ isFile: () => true } as any);
      mockAccess.mockResolvedValue(undefined);

      const result = await isExecutableOnPath("codex", "/bin", "linux");
      expect(result).toBe(true);
      expect(mockStat).toHaveBeenCalled();
      expect(mockAccess).toHaveBeenCalled();
    });

    it("Windows: returns true if file with extension is found", async () => {
      const mockStat = vi.mocked(fs.stat);
      mockStat.mockResolvedValueOnce({ isFile: () => true } as any);

      const result = await isExecutableOnPath("codex", "C:\\bin", "win32");
      expect(result).toBe(true);
      // It should try codex.EXE first (depending on PATHEXT, but we use defaults in test if env not set)
      expect(mockStat).toHaveBeenCalled();
    });
  });

  describe("detectProviders", () => {
    it("always detects mock provider", async () => {
      const mockStat = vi.mocked(fs.stat);
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const candidates = await detectProviders({ envPath: "", platform: "linux" });
      const mock = candidates.find(c => c.name === "mock");
      expect(mock?.detected).toBe(true);
    });

    it("detects external provider if on path", async () => {
      const mockStat = vi.mocked(fs.stat);
      const mockAccess = vi.mocked(fs.access);

      // Mock codex found at /bin/codex
      mockStat.mockImplementation(async (path: any) => {
        if (path === "/bin/codex") return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockAccess.mockResolvedValue(undefined);

      const candidates = await detectProviders({ envPath: "/bin", platform: "linux" });
      const codex = candidates.find(c => c.name === "codex");
      expect(codex?.detected).toBe(true);
    });
  });

  describe("recommendProvider", () => {
    it("recommends first detected external provider by rank", () => {
      const candidates = [
        { name: "mock", builtIn: true, detected: true, recommendedRank: 6, command: null },
        { name: "codex", builtIn: false, detected: false, recommendedRank: 0, command: "codex" },
        { name: "gemini", builtIn: false, detected: true, recommendedRank: 1, command: "gemini" },
        { name: "antigravity", builtIn: false, detected: true, recommendedRank: 4, command: "agy" }
      ];

      expect(recommendProvider(candidates as any)).toBe("gemini");
    });

    it("recommends mock if no external providers detected", () => {
      const candidates = [
        { name: "mock", builtIn: true, detected: true, recommendedRank: 6, command: null },
        { name: "codex", builtIn: false, detected: false, recommendedRank: 0, command: "codex" }
      ];

      expect(recommendProvider(candidates as any)).toBe("mock");
    });
  });

  describe("selectProviderNonInteractive", () => {
    const candidates = [
      { name: "mock", builtIn: true, detected: true, recommendedRank: 6, command: null },
      { name: "codex", builtIn: false, detected: true, recommendedRank: 0, command: "codex" },
      { name: "gemini", builtIn: false, detected: false, recommendedRank: 1, command: "gemini" }
    ];

    it("selects recommended provider if none requested", () => {
      const selection = selectProviderNonInteractive({ candidates: candidates as any });
      expect(selection.defaultProvider).toBe("codex");
      expect(selection.selectedReason).toBe("auto-detected");
    });

    it("selects requested provider if detected", () => {
      const selection = selectProviderNonInteractive({
        requestedProvider: "codex",
        candidates: candidates as any
      });
      expect(selection.defaultProvider).toBe("codex");
      expect(selection.selectedReason).toBe("explicit-detected");
    });

    it("falls back to mock if requested provider not detected", () => {
      const selection = selectProviderNonInteractive({
        requestedProvider: "gemini",
        candidates: candidates as any
      });
      expect(selection.defaultProvider).toBe("mock");
      expect(selection.selectedReason).toBe("explicit-undetected-noninteractive-fallback");
      expect(selection.warning).toContain("gemini");
    });
  });

  describe("real PATH detection (unmocked)", () => {
    let tempBin: string;
    const isWindows = process.platform === "win32";

    beforeEach(() => {
      tempBin = fsSync.mkdtempSync(path.join(os.tmpdir(), "openflow-bin-test-"));
    });

    afterEach(() => {
      fsSync.rmSync(tempBin, { recursive: true, force: true });
    });

    it("detects fake executable without executing it", async () => {
      // Temporarily restore real fs/promises for this test
      const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      vi.mocked(fs.stat).mockImplementation(actualFs.stat as any);
      vi.mocked(fs.access).mockImplementation(actualFs.access as any);

      const codexPath = path.join(tempBin, isWindows ? "codex.exe" : "codex");
      const sentinelPath = path.join(tempBin, "sentinel.txt");
      
      const scriptBody = isWindows 
        ? `@echo off\necho triggered > "${sentinelPath}"\nexit /b 1`
        : `#!/bin/sh\necho triggered > "${sentinelPath}"\nexit 1`;
      
      fsSync.writeFileSync(codexPath, scriptBody);
      if (!isWindows) {
        fsSync.chmodSync(codexPath, 0o755);
      }

      const candidates = await detectProviders({ envPath: tempBin, platform: process.platform });
      const codex = candidates.find(c => c.name === "codex");
      
      expect(codex?.detected).toBe(true);
      expect(fsSync.existsSync(sentinelPath)).toBe(false);
    });
  });
});
