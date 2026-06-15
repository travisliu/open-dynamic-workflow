import { describe, it, expect, vi } from "vitest";
import { promptProviderSelection, promptUnavailableRequestedProvider, confirmInitPlan } from "../../src/cli/init/prompts.js";
import * as readline from "node:readline/promises";
import { ProviderCandidate } from "../../src/cli/init/types.js";

vi.mock("node:readline/promises");

describe("init prompts", () => {
  const mockCandidates: ProviderCandidate[] = [
    { name: "mock", detected: true, builtIn: true, command: "mock", recommendedRank: 100 },
    { name: "codex", detected: true, builtIn: false, command: "codex", recommendedRank: 1 },
    { name: "gemini", detected: false, builtIn: false, command: "gemini", recommendedRank: 2 }
  ];

  it("handles provider selection - user selects a valid candidate", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue("codex"),
      close: vi.fn()
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const stdout = { write: vi.fn() } as any;
    const result = await promptProviderSelection({ stdin: {} as any, stdout, candidates: mockCandidates });

    expect(result).toEqual({
      defaultProvider: "codex",
      selectedReason: "interactive-choice"
    });
    expect(mockRl.close).toHaveBeenCalled();
  });

  it("handles provider selection - user accepts recommendation (Enter)", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue(""),
      close: vi.fn()
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const stdout = { write: vi.fn() } as any;
    const result = await promptProviderSelection({ stdin: {} as any, stdout, candidates: mockCandidates });

    expect(result).toEqual({
      defaultProvider: "codex",
      selectedReason: "interactive-choice"
    });
  });

  it("handles provider selection - user cancels", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue("c"),
      close: vi.fn()
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const stdout = { write: vi.fn() } as any;
    const result = await promptProviderSelection({ stdin: {} as any, stdout, candidates: mockCandidates });

    expect(result).toBe("cancel");
  });

  it("handles unavailable requested provider - user continues", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue("1"),
      close: vi.fn()
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const stdout = { write: vi.fn() } as any;
    const result = await promptUnavailableRequestedProvider({
      stdin: {} as any,
      stdout,
      requested: "gemini",
      candidates: mockCandidates
    });

    expect(result).toEqual({
      defaultProvider: "gemini",
      requestedProvider: "gemini",
      selectedReason: "explicit-undetected-interactive-continue"
    });
  });

  it("handles unavailable requested provider - user switches to mock", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue("2"),
      close: vi.fn()
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const stdout = { write: vi.fn() } as any;
    const result = await promptUnavailableRequestedProvider({
      stdin: {} as any,
      stdout,
      requested: "gemini",
      candidates: mockCandidates
    });

    expect(result).toEqual({
      defaultProvider: "mock",
      requestedProvider: "gemini",
      selectedReason: "interactive-choice"
    });
  });

  it("handles plan confirmation - user accepts", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue("y"),
      close: vi.fn()
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const stdout = { write: vi.fn() } as any;
    const result = await confirmInitPlan({
      stdin: {} as any,
      stdout,
      plan: { targets: [], providerSelection: { defaultProvider: "mock" } } as any
    });

    expect(result).toBe(true);
  });

  it("handles plan confirmation - user declines", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue("n"),
      close: vi.fn()
    };
    vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

    const stdout = { write: vi.fn() } as any;
    const result = await confirmInitPlan({
      stdin: {} as any,
      stdout,
      plan: { targets: [], providerSelection: { defaultProvider: "mock" } } as any
    });

    expect(result).toBe(false);
  });
});
