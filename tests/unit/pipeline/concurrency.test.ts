import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter, createLimiter, getEffectiveStageConcurrency } from "../../../src/pipeline/concurrency.js";

describe("concurrency limiter", () => {
  it("allows running tasks up to a limit in parallel", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let maxActive = 0;

    const runTask = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
    };

    await Promise.all([
      limiter.run(runTask),
      limiter.run(runTask),
      limiter.run(runTask),
      limiter.run(runTask)
    ]);

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("handles limit of Infinity or undefined", async () => {
    const limiter = createLimiter(Infinity);
    let active = 0;
    let maxActive = 0;

    const runTask = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    };

    await Promise.all([
      limiter.run(runTask),
      limiter.run(runTask),
      limiter.run(runTask)
    ]);

    expect(maxActive).toBe(3);
  });
});

describe("getEffectiveStageConcurrency", () => {
  it("uses the minimum of positive concurrency limits", () => {
    // stage prop = 2, pipeline options = 5, stage override options = 3 -> stricter is 2
    expect(getEffectiveStageConcurrency("stageA", 2, 5, 3)).toBe(2);

    // stage prop = 4, pipeline options = 1, stage override options = 3 -> stricter is 1
    expect(getEffectiveStageConcurrency("stageA", 4, 1, 3)).toBe(1);

    // stage prop = 4, pipeline options = 5, stage override options = 2 -> stricter is 2
    expect(getEffectiveStageConcurrency("stageA", 4, 5, 2)).toBe(2);
  });

  it("handles undefined/zero/negative limits appropriately", () => {
    // Stage prop positive, others undefined
    expect(getEffectiveStageConcurrency("stageA", 3, undefined, undefined)).toBe(3);

    // No positive limits at all -> returns Infinity
    expect(getEffectiveStageConcurrency("stageA", undefined, undefined, undefined)).toBe(Infinity);
    expect(getEffectiveStageConcurrency("stageA", 0, -1, undefined)).toBe(Infinity);

    // Some undefined, some positive
    expect(getEffectiveStageConcurrency("stageA", undefined, 5, 2)).toBe(2);
    expect(getEffectiveStageConcurrency("stageA", 4, undefined, 6)).toBe(4);
  });
});

