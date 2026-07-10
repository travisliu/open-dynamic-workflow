import { describe, expect, it, vi } from "vitest";
import { emitProviderResolutionEvents } from "../../../src/output/provider-selection-events.js";

describe("provider selection events", () => {
  it("emits alias resolution followed by recorded overrides in order", async () => {
    const events: Array<{ type: string; payload: any }> = [];
    const eventSink = {
      emit: vi.fn(async (type: string, payload: unknown) => {
        events.push({ type, payload });
      }),
    };

    await emitProviderResolutionEvents({
      eventSink,
      agentId: "agent-1",
      selection: {
        providerAlias: "deep-review",
        providerAliasChain: ["base", "deep-review"],
        providerAliasDigest: "digest",
        requestedProvider: "deep-review",
        requestedProviderSource: "agent",
        provider: "codex",
        overrides: [
          {
            setting: "model",
            selected: { value: "gpt-5.4", source: "agent", sourcePath: "agent.model" },
            overridden: {
              value: "gpt-5.4-mini",
              source: "providerAlias",
              sourcePath: "providerAliases.deep-review.model",
            },
          },
          {
            setting: "timeoutMs",
            selected: { value: 1000, source: "agent", sourcePath: "agent.timeoutMs" },
            overridden: { value: 5000, source: "providerConfig", sourcePath: "providers.codex.timeoutMs" },
          },
        ],
      },
    } as any);

    expect(events.map((event) => event.type)).toEqual([
      "agent.provider-alias-resolved",
      "agent.provider-setting-overridden",
      "agent.provider-setting-overridden",
    ]);
    expect(events[1]!.payload.selectedValue).toBe("gpt-5.4");
    expect(events[2]!.payload.overriddenValue).toBe(5000);
  });

  it("does not emit direct-provider resolution events and never reads retry getters", async () => {
    const emit = vi.fn();
    let getterCalled = false;
    const retry = {
      get enabled() {
        getterCalled = true;
        return true;
      },
      secret: "do-not-emit",
    };

    await emitProviderResolutionEvents({
      eventSink: { emit },
      agentId: "agent-2",
      selection: {
        requestedProvider: "codex",
        requestedProviderSource: "agent",
        provider: "codex",
        overrides: [
          {
            setting: "retry",
            selected: { value: retry, source: "agent", sourcePath: "agent.retry" },
            overridden: {
              value: { enabled: false },
              source: "builtIn",
              sourcePath: "builtIn.retry",
            },
          },
        ],
      },
    } as any);

    expect(getterCalled).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
    const payload = emit.mock.calls[0]![1] as any;
    expect(payload.providerAlias).toBeUndefined();
    expect(payload.selectedValue).toEqual({});
    expect(JSON.stringify(payload)).not.toContain("do-not-emit");
  });
});
