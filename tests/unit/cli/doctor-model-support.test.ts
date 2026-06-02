import { describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../../../src/cli/commands/doctor.js";
import type { ProviderHealthChecker } from "../../../src/doctors/public.js";

describe("Doctor Model Support Output", () => {
  it("prints provider default models and model selection support", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const mockChecker: ProviderHealthChecker = {
      async checkAll() {
        return {
          ok: true,
          providers: [
            {
              provider: "mock-provider-1",
              ok: true,
              message: "available",
              defaultModel: "model-abc",
              supportsModelSelection: true
            },
            {
              provider: "mock-provider-2",
              ok: true,
              message: "available",
              defaultModel: null,
              supportsModelSelection: false
            }
          ]
        };
      }
    };

    await doctorCommand({
      rawOptions: { cwd: process.cwd() },
      deps: { providerHealthChecker: mockChecker }
    });

    const calls = logSpy.mock.calls.map(c => c[0] || "");
    const output = calls.join("\n");

    expect(output).toContain("mock-provider-1");
    expect(output).toContain("default model: model-abc");
    expect(output).toContain("supports model selection");
    expect(output).toContain("mock-provider-2");
    expect(output).toContain("no model selection");

    logSpy.mockRestore();
  });
});
