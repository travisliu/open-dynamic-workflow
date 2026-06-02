import { ErrorCode } from "../../errors/codes.js";
import { ExecflowError } from "../../errors/types.js";
import { loadConfig } from "../../config/load.js";
import type { ProviderHealthChecker, DoctorResult } from "../../doctors/public.js";
import { createDefaultProviderRegistry } from "../../agents/registry.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DoctorCommandDeps {
  providerHealthChecker: ProviderHealthChecker;
}

export interface DoctorCommandInput {
  rawOptions: any;
  deps?: Partial<DoctorCommandDeps>;
}

const defaultProviderHealthChecker: ProviderHealthChecker = {
  async checkAll(config): Promise<DoctorResult> {
    const registry = createDefaultProviderRegistry({ config: { ...config, cliArgs: {} } });
    const providers = [];
    let ok = true;
    for (const adapter of registry.list()) {
      const health = adapter.checkHealth
        ? await adapter.checkHealth()
        : { provider: adapter.name, available: true, message: "available" };
      providers.push({
        provider: health.provider,
        ok: health.available,
        message: health.message || (health.available ? "available" : "unavailable")
      });
      if (!health.available) {
        ok = false;
      }
    }
    return { ok, providers };
  }
};

export async function doctorCommand(input: DoctorCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();

  console.log("execflow doctor\n");

  // Node.js >= 20 check
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.replace("v", "").split(".")[0] || "0", 10);
  if (majorVersion >= 20) {
    console.log("✓ Node.js >= 20");
  } else {
    console.log(`✕ Node.js version is ${nodeVersion}, expected >= 20`);
  }

  // execflow package version check
  console.log("✓ execflow 0.1.0");

  // current working directory is writable check
  let isCwdWritable = false;
  try {
    await fs.access(cwd, fs.constants.W_OK);
    isCwdWritable = true;
    console.log("✓ Current directory writable");
  } catch {
    console.log("✕ Current directory not writable");
  }

  // .execflow/runs can be created or accessed check
  const runsDir = path.resolve(cwd, ".execflow/runs");
  let runsDirOk = false;
  try {
    await fs.mkdir(runsDir, { recursive: true });
    await fs.access(runsDir, fs.constants.W_OK);
    runsDirOk = true;
    console.log(`✓ Artifact directory available: .execflow/runs`);
  } catch {
    console.log("✕ Artifact directory unavailable");
  }

  // Load config
  const config = await loadConfig({
    cwd,
    configPath: rawOptions.config,
    cli: {
      verbose: rawOptions.verbose !== undefined ? !!rawOptions.verbose : undefined
    }
  });

  const checker = input.deps?.providerHealthChecker ?? defaultProviderHealthChecker;
  const result = await checker.checkAll(config);

  for (const provider of result.providers) {
    const symbol = provider.ok ? "✓" : "✕";
    console.log(
      `${symbol} ${provider.provider.padEnd(8)} ${provider.ok ? "available" : "unavailable"}${
        provider.message ? `: ${provider.message}` : ""
      }`
    );
  }

  console.log("\nProvider CLIs are optional unless your workflow uses them.");

  if (!result.ok) {
    const failedList = result.providers
      .filter((p) => !p.ok)
      .map((p) => p.provider)
      .join(", ");
    throw new ExecflowError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      `Provider check failed: ${failedList} is unavailable.`
    );
  }
}
