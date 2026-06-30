import { ErrorCode } from "../../errors/codes.js";
import { OpenDynamicWorkflowError } from "../../errors/types.js";
import { loadConfig } from "../../config/load.js";
import { loadToolRegistry } from "../../tools/load.js";
import type { ProviderHealthChecker, DoctorResult } from "../../doctors/public.js";
import { createDefaultProviderRegistry } from "../../agents/registry.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getPackageVersion } from "../package-info.js";

export interface DoctorCommandDeps {
  providerHealthChecker: ProviderHealthChecker;
}

export interface DoctorCommandInput {
  rawOptions: any;
  deps?: Partial<DoctorCommandDeps>;
}

const defaultProviderHealthChecker: ProviderHealthChecker = {
  async checkAll(config): Promise<DoctorResult> {
    const registry = createDefaultProviderRegistry({ config: { ...config, cliArgs: {} } as any });
    const providers = [];
    let ok = true;
    for (const adapter of registry.list()) {
      const health = adapter.checkHealth
        ? await adapter.checkHealth()
        : { provider: adapter.name, available: true, message: "available", supportsModelSelection: true };
      
      const providerConfig = config.providers[adapter.name];
      const defaultModel = providerConfig ? providerConfig.defaultModel : null;

      providers.push({
        provider: health.provider,
        ok: health.available,
        message: health.message || (health.available ? "available" : "unavailable"),
        defaultModel,
        supportsModelSelection: health.supportsModelSelection !== false
      });
      if (!health.available && adapter.name === config.defaultProvider) {
        ok = false;
      }
    }
    return { ok, providers };
  }
};

function formatToolRegistryError(err: unknown): string {
  if (err instanceof OpenDynamicWorkflowError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export async function doctorCommand(input: DoctorCommandInput): Promise<void> {
  const rawOptions = input.rawOptions || {};
  const cwd = rawOptions.cwd ?? process.cwd();

  console.log("open-dynamic-workflow doctor\n");

  // Node.js >= 20 check
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.replace("v", "").split(".")[0] || "0", 10);
  if (majorVersion >= 20) {
    console.log("✓ Node.js >= 20");
  } else {
    console.log(`✕ Node.js version is ${nodeVersion}, expected >= 20`);
  }

  // open-dynamic-workflow package version check
  console.log(`✓ open-dynamic-workflow ${await getPackageVersion()}`);

  // current working directory is writable check
  try {
    await fs.access(cwd, fs.constants.W_OK);
    console.log("✓ Current directory writable");
  } catch {
    console.log("✕ Current directory not writable");
  }

  // .open-dynamic-workflow/runs can be created or accessed check
  const runsDir = path.resolve(cwd, ".open-dynamic-workflow/runs");
  try {
    await fs.mkdir(runsDir, { recursive: true });
    await fs.access(runsDir, fs.constants.W_OK);
    console.log(`✓ Artifact directory available: .open-dynamic-workflow/runs`);
  } catch {
    console.log("✕ Artifact directory unavailable");
  }

  // Load config
  const config = await loadConfig({
    cwd,
    configPath: rawOptions.config,
    cli: {
      verbose: rawOptions.verbose !== undefined ? !!rawOptions.verbose : undefined
    },
    diagnosticContext: "doctor",
    discoveryCliOverrides: {
      resourceType: rawOptions.resourceType,
      dir: rawOptions.dir,
      workflowsDir: rawOptions.workflowsDir,
      agentsDir: rawOptions.agentsDir,
      toolsDir: rawOptions.toolsDir
    }
  });

  const { precollectAllResourcesForLoad } = await import("../../discovery/precollect.js");
  const precollected = await precollectAllResourcesForLoad({
    cwd: config.cwd,
    discovery: config._normalizedDiscovery,
    strict: false
  });

  const workflowCount = precollected.workflow.collectionResult.files.length;
  const agentCount = precollected.sharedAgents.collectionResult.files.length;
  const toolCount = precollected.tools.collectionResult.files.length;

  console.log(`✓ Discovery: workflows ${workflowCount}, shared agents ${agentCount}, tools ${toolCount}`);

  function simplifyDefaultPatternLabel(pattern: string, source: string): string {
    if (source !== "default") {
      return pattern;
    }
    const match = pattern.match(/\.([a-z]+)$/i);
    if (match) {
      return `*.${match[1]}`;
    }
    return pattern;
  }

  const collectionDiagnostics = [
    ...precollected.workflow.collectionResult.diagnostics,
    ...precollected.sharedAgents.collectionResult.diagnostics,
    ...precollected.tools.collectionResult.diagnostics,
  ];

  const collectionConfigDiagnostics = [
    ...precollected.workflow.collectionResult.configDiagnostics,
    ...precollected.sharedAgents.collectionResult.configDiagnostics,
    ...precollected.tools.collectionResult.configDiagnostics,
  ];

  const collectionWarningCount = collectionDiagnostics.filter(d => d.severity === "warning").length +
    collectionConfigDiagnostics.filter(d => d.severity === "warning").length;
  const collectionErrorCount = collectionDiagnostics.filter(d => d.severity === "error").length +
    collectionConfigDiagnostics.filter(d => d.severity === "error").length;

  if (collectionWarningCount > 0 || collectionErrorCount > 0) {
    console.log(`⚠ Discovery diagnostics: ${collectionWarningCount} warnings, ${collectionErrorCount} errors`);
  }

  if (rawOptions.verbose) {
    console.log("\nDiscovery Metrics:");
    const resourcesList = [
      { name: "Workflows", key: "workflow" },
      { name: "Shared Agents", key: "sharedAgents" },
      { name: "Tools", key: "tools" }
    ] as const;

    for (const resInfo of resourcesList) {
      const resResult = precollected[resInfo.key];
      console.log(`  ${resInfo.name}:`);
      
      for (const metric of resResult.collectionResult.metrics) {
        const displayPattern = simplifyDefaultPatternLabel(metric.pattern, metric.source);
        console.log(`    Pattern: ${displayPattern} (${metric.configPath}, source: ${metric.source})`);
        console.log(`      Matched: ${metric.matchedPathCount}, Accepted: ${metric.acceptedCandidateCount}`);
        console.log(`      Rejected by Marker: ${metric.rejectedByMarkerCount}, Excluded: ${metric.excludedCandidateCount}, Rejected by Safety: ${metric.rejectedBySafetyCount}`);
      }

      const resConfigDiags = resResult.collectionResult.configDiagnostics;

      if (resConfigDiags.length > 0) {
        for (const d of resConfigDiags) {
          console.log(`    [${d.severity === "error" ? "Error" : "Warning"}] ${d.code} (${d.path}): ${d.message}`);
        }
      }
    }
  }

  const toolDiagnostics: any[] = [];
  try {
    const toolRegistry = await loadToolRegistry({
      cwd: config.cwd,
      precollected: precollected.tools.loadInput,
      maxDefinitions: config.tools?.maxDefinitions ?? 100,
      configDiagnostics: toolDiagnostics
    });
    const loadedToolCount = toolRegistry.list().length;
    console.log(`✓ Tool registry loaded (${loadedToolCount} tools)`);
  } catch (err: any) {
    console.log(`✕ Tool registry failed to load: ${formatToolRegistryError(err)}`);
  }

  const allDoctorDiags = [
    ...(config._configDiagnostics || []),
    ...collectionConfigDiagnostics,
    ...collectionDiagnostics,
    ...toolDiagnostics
  ];

  if (allDoctorDiags.length > 0) {
    console.log("\nConfiguration Diagnostics:");
    for (const d of allDoctorDiags) {
      const typeStr = d.severity === "error" ? "Error" : "Warning";
      console.log(`  [${typeStr}] ${d.path || (d as any).path} ${d.code}: ${d.message}`);
      if (rawOptions.verbose) {
        if ((d as any).hint) {
          console.log(`    Hint: ${(d as any).hint}`);
        }
        if ((d as any).migration) {
          console.log(`    Migration: Migrate ${(d as any).migration.ignoredKey} to ${(d as any).resource}.include`);
        }
      }
    }
    console.log();
  }


  const checker = input.deps?.providerHealthChecker ?? defaultProviderHealthChecker;
  const result = await checker.checkAll(config);

  for (const provider of result.providers) {
    const symbol = provider.ok ? "✓" : "✕";
    const defaultModelStr = provider.defaultModel ? ` (default model: ${provider.defaultModel})` : "";
    const modelSelectionStr = provider.supportsModelSelection ? " [supports model selection]" : " [no model selection]";
    console.log(
      `${symbol} ${provider.provider.padEnd(8)} ${provider.ok ? "available" : "unavailable"}${
        provider.message ? `: ${provider.message}` : ""
      }${defaultModelStr}${modelSelectionStr}`
    );
  }

  console.log("\nProvider CLIs are optional unless your workflow uses them.");

  if (!result.ok) {
    const failedList = result.providers
      .filter((p) => !p.ok)
      .map((p) => p.provider)
      .join(", ");
    throw new OpenDynamicWorkflowError(
      ErrorCode.PROVIDER_UNAVAILABLE,
      `Provider check failed: ${failedList} is unavailable.`
    );
  }
}
