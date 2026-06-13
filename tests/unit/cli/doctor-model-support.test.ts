import { describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../../../src/cli/commands/doctor.js";
import { loadConfig } from "../../../src/config/load.js";

vi.mock("../../../src/config/load.js", () => ({
  loadConfig: vi.fn()
}));

vi.mock("../../../src/tools/load.js", () => ({
  loadToolRegistry: vi.fn().mockResolvedValue({ list: () => [] })
}));

describe("Doctor Model Support Output", () => {
  it("62. does not throw for unavailable optional provider when default provider is available", async () => {
    // Arrange
    const mockChecker = {
      checkAll: vi.fn().mockResolvedValue({
        ok: true,
        providers: [
          { provider: "mock", ok: true, message: "available", defaultModel: null, supportsModelSelection: true },
          { provider: "opencode", ok: false, message: "not found", defaultModel: "gpt-4", supportsModelSelection: true }
        ]
      })
    };
    vi.mocked(loadConfig).mockResolvedValue({
      defaultProvider: "mock",
      providers: {
        mock: { command: "mock" },
        opencode: { command: "opencode", defaultModel: "gpt-4" }
      },
      cwd: "/root",
      outDir: "/root/out"
    } as any);

    const rawOptions = { config: "config.yaml" };
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Act & Assert
    await expect(doctorCommand({ rawOptions, deps: { providerHealthChecker: mockChecker as any } })).resolves.not.toThrow();
    
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("63. preserves model support output for new providers", async () => {
    // Arrange
    const mockChecker = {
      checkAll: vi.fn().mockResolvedValue({
        ok: true,
        providers: [
          { provider: "opencode", ok: true, message: "available", defaultModel: "gpt-4", supportsModelSelection: true },
          { provider: "antigravity", ok: true, message: "available", defaultModel: "claude-3", supportsModelSelection: false },
          { provider: "pi", ok: true, message: "available", defaultModel: null, supportsModelSelection: true }
        ]
      })
    };
    vi.mocked(loadConfig).mockResolvedValue({
      defaultProvider: "opencode",
      providers: {
        opencode: { command: "opencode", defaultModel: "gpt-4" },
        antigravity: { command: "agy", defaultModel: "claude-3" },
        pi: { command: "pi" }
      },
      cwd: "/root",
      outDir: "/root/out"
    } as any);

    const rawOptions = { config: "config.yaml" };
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Act
    await doctorCommand({ rawOptions, deps: { providerHealthChecker: mockChecker as any } });

    // Assert
    const allOutput = consoleSpy.mock.calls.map(call => call[0]).join("\n");
    expect(allOutput).toContain("opencode");
    expect(allOutput).toContain("gpt-4");
    expect(allOutput).toContain("antigravity");
    expect(allOutput).toContain("claude-3");
    expect(allOutput).toContain("pi");
    
    consoleSpy.mockRestore();
  });
});
