import { describe, expect, it } from "vitest";
import { toResolvedConfigArtifact } from "../../../src/config/resolved-artifact.js";

describe("Resolved Config Artifact Projection", () => {
  it("omits private resolution metadata while retaining the resolved absolute outDir", () => {
    const resolvedConfig = {
      defaultProvider: "mock",
      concurrency: 4,
      timeoutMs: 30000,
      providers: {
        mock: { command: "mock", defaultModel: null }
      },
      providerAliases: {
        aliasA: {
          name: "aliasA",
          provider: "mock",
          inheritanceChain: ["aliasA"],
          digest: "sha256:aliasA-digest",
          origins: { provider: "aliasA" }
        }
      },
      _executionDefaultLayers: {
        cli: {},
        config: {},
        builtIn: { defaultProvider: "mock", timeoutMs: 30000 }
      },
      _resolution: {
        outDir: { path: "/runs", source: "config", rawValue: "runs" }
      },
      outDir: "/runs",
      _someOtherInternalField: "should-remain"
    };

    const projected: any = toResolvedConfigArtifact(resolvedConfig);

    // Assert _executionDefaultLayers is omitted
    expect(projected._executionDefaultLayers).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(projected, "_executionDefaultLayers")).toBe(false);
    expect(projected._resolution).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(projected, "_resolution")).toBe(false);

    // Assert other fields remain present
    expect(projected.defaultProvider).toBe("mock");
    expect(projected.concurrency).toBe(4);
    expect(projected.timeoutMs).toBe(30000);
    expect(projected.outDir).toBe("/runs");
    expect(projected.providers).toEqual({
      mock: { command: "mock", defaultModel: null }
    });
    expect(projected._someOtherInternalField).toBe("should-remain");

    // Assert the safe provider-alias projection is in use (origins field is omitted in alias projection)
    expect(projected.providerAliases.aliasA).toBeDefined();
    expect(projected.providerAliases.aliasA.origins).toBeUndefined();
    expect(projected.providerAliases.aliasA.digest).toBe("sha256:aliasA-digest");

    // Assert serialized JSON does not contain _executionDefaultLayers
    const jsonStr = JSON.stringify(projected);
    const parsed = JSON.parse(jsonStr);
    expect(parsed._executionDefaultLayers).toBeUndefined();
    expect(parsed._resolution).toBeUndefined();
    expect(parsed.outDir).toBe("/runs");
    expect(parsed.defaultProvider).toBe("mock");
    expect(parsed.providerAliases.aliasA.digest).toBe("sha256:aliasA-digest");
  });
});
