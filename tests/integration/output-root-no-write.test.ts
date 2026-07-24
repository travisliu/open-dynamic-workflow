import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: vi.fn((...args: any[]) => (actual.stat as any)(...args)),
    lstat: vi.fn((...args: any[]) => (actual.lstat as any)(...args)),
    readdir: vi.fn((...args: any[]) => (actual.readdir as any)(...args)),
    mkdir: vi.fn((...args: any[]) => (actual.mkdir as any)(...args)),
    access: vi.fn((...args: any[]) => (actual.access as any)(...args)),
    open: vi.fn((...args: any[]) => (actual.open as any)(...args)),
    writeFile: vi.fn((...args: any[]) => (actual.writeFile as any)(...args)),
    unlink: vi.fn((...args: any[]) => (actual.unlink as any)(...args)),
    rm: vi.fn((...args: any[]) => (actual.rm as any)(...args)),
  };
});

import * as fs from "node:fs/promises";
import { main } from "../../src/cli/index.js";

const trackedMethods = ["stat", "lstat", "readdir", "mkdir", "access", "open", "writeFile", "unlink", "rm"] as const;

function normalizePath(value: unknown): string | undefined {
  if (typeof value === "string") return path.resolve(value);
  if (value instanceof URL) return path.resolve(value.pathname);
  return undefined;
}

function callsTargeting(root: string): Array<{ method: string; path: string }> {
  const normalizedRoot = path.resolve(root);
  const rootPrefix = normalizedRoot + path.sep;
  return trackedMethods.flatMap((method) => {
    const mock = (fs as any)[method] as ReturnType<typeof vi.fn>;
    return mock.mock.calls.flatMap((call: unknown[]) => {
      const target = normalizePath(call[0]);
      return target === normalizedRoot || target?.startsWith(rootPrefix)
        ? [{ method, path: target }]
        : [];
    });
  });
}

describe("commands do not probe or write unresolved output roots", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "odw-output-root-no-write-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  async function writeProject(config: string): Promise<void> {
    await fs.mkdir(path.join(tempDir, ".open-dynamic-workflow"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "workflows"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), config);
    await fs.writeFile(path.join(tempDir, "workflows/example.workflow.ts"), `
export const meta = { name: "example", description: "example", phases: ["run"] };
phase("run");
export default {};
`);
  }

  async function runCli(args: string[]): Promise<string> {
    const output: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...values) => {
      output.push(values.join(" "));
    });
    try {
      await main(["node", "odw", ...args]);
    } finally {
      logSpy.mockRestore();
    }
    return output.join("\n");
  }

  function clearRootCallHistory(): void {
    for (const method of trackedMethods) {
      vi.mocked((fs as any)[method]).mockClear();
    }
  }

  async function expectNoRootCalls(root: string, action: () => Promise<string>): Promise<string> {
    clearRootCallHistory();
    const output = await action();
    const observed = callsTargeting(root);
    expect(observed).toEqual([]);
    expect(existsSync(root)).toBe(false);
    return output;
  }

  it("does not probe a missing configured global root during verbose dry-run", async () => {
    const root = path.join(tempDir, "missing-global-runs");
    await writeProject(`outDir: missing-global-runs\n`);

    const output = await expectNoRootCalls(root, () => runCli([
      "run", "example", "--cwd", tempDir, "--dry-run", "--verbose"
    ]));

    expect(output).toContain(`Artifacts root: ${root}`);
    expect(output).toContain("Output-root source: config");
  });

  it("does not probe selected profile roots or profile fallthrough roots during dry-run", async () => {
    const profileRoot = path.join(tempDir, "missing-profile-runs");
    await writeProject(`outDir: missing-global-runs
profiles:
  ci:
    outDir: missing-profile-runs
  fallback: {}
`);

    const profileOutput = await expectNoRootCalls(profileRoot, () => runCli([
      "run", "example", "--cwd", tempDir, "--profile", "ci", "--dry-run", "--verbose"
    ]));
    expect(profileOutput).toContain("Output-root source: profile");
    expect(profileOutput).toContain("Selected profile: ci");

    const fallthroughRoot = path.join(tempDir, "missing-global-runs");
    const fallthroughOutput = await expectNoRootCalls(fallthroughRoot, () => runCli([
      "run", "example", "--cwd", tempDir, "--profile", "fallback", "--dry-run", "--verbose"
    ]));
    expect(fallthroughOutput).toContain("Output-root source: config");
    expect(fallthroughOutput).toContain("Selected profile: fallback");
  });

  it("does not probe a missing external CLI output root during dry-run", async () => {
    await writeProject("{}");
    const root = path.join(os.tmpdir(), `odw-external-missing-${crypto.randomUUID()}`);

    const output = await expectNoRootCalls(root, () => runCli([
      "run", "example", "--cwd", tempDir, "--out", root, "--dry-run", "--verbose"
    ]));

    expect(output).toContain(`Artifacts root: ${root}`);
    expect(output).toContain("Output-root source: cli");
  });

  it("does not probe missing configured roots for validate or list", async () => {
    const root = path.join(tempDir, "missing-external-runs");
    await writeProject("outDir: missing-external-runs\n");

    await expectNoRootCalls(root, () => runCli(["validate", "example", "--cwd", tempDir]));
    await expectNoRootCalls(root, () => runCli(["list", "--cwd", tempDir]));
  });

  it("emits the literal default root without targeting it during ordinary init", async () => {
    const root = path.join(tempDir, ".open-dynamic-workflow/runs");

    await expectNoRootCalls(root, async () => {
      await runCli(["init", "--yes", "--cwd", tempDir]);
      const config = parseYaml(await fs.readFile(path.join(tempDir, ".open-dynamic-workflow/config.yaml"), "utf8"));
      expect(config.outDir).toBe(".open-dynamic-workflow/runs");
      return "";
    });
  });
});
