import path from "node:path";
import { OpenDynamicWorkflowError } from "../../errors/types.js";
import { ErrorCode } from "../../errors/codes.js";
import { parseInitOptions } from "../args.js";
import {
  ResolvedInitOptions,
  ProviderSelection,
  InitResult,
  ProviderCandidate
} from "../init/types.js";
import {
  detectProviders,
  selectProviderNonInteractive,
  isSupportedInitProvider
} from "../init/providers.js";
import {
  resolveProjectPath,
  DEFAULT_INIT_WORKFLOWS_DIR,
  DEFAULT_INIT_AGENTS_DIR,
  DEFAULT_INIT_TOOLS_DIR,
  DEFAULT_INIT_EXAMPLE_FILE
} from "../init/defaults.js";
import { buildInitPlan } from "../init/planner.js";
import { applyInitPlan } from "../init/writer.js";
import { runInitSmokeTest } from "../init/smoke-test.js";
import {
  promptProviderSelection,
  promptUnavailableRequestedProvider,
  confirmInitPlan
} from "../init/prompts.js";
import { printInitSummary, formatStrictConflicts, formatCancellationMessage } from "../init/summary.js";

export interface InitCommandInput {
  rawOptions: any;
  deps?: {
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
    isTty?: boolean;
    detectProviders?: typeof detectProviders;
    selectProviderNonInteractive?: typeof selectProviderNonInteractive;
    buildInitPlan?: typeof buildInitPlan;
    applyInitPlan?: typeof applyInitPlan;
    runInitSmokeTest?: typeof runInitSmokeTest;
    promptProviderSelection?: typeof promptProviderSelection;
    promptUnavailableRequestedProvider?: typeof promptUnavailableRequestedProvider;
    confirmInitPlan?: typeof confirmInitPlan;
  };
}

export async function initCommand(input: InitCommandInput): Promise<void> {
  const { rawOptions } = input;
  const deps = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    isTty: process.stdin.isTTY,
    detectProviders,
    selectProviderNonInteractive,
    buildInitPlan,
    applyInitPlan,
    runInitSmokeTest,
    promptProviderSelection,
    promptUnavailableRequestedProvider,
    confirmInitPlan,
    ...input.deps
  };

  // 1. Normalize and validate raw options
  const cliOptions = parseInitOptions(rawOptions);
  const cwd = path.resolve(cliOptions.cwd || process.cwd());

  const workflowsDir = resolveProjectPath(cwd, cliOptions.workflowsDir ?? DEFAULT_INIT_WORKFLOWS_DIR, "workflows-dir");
  const agentsDir = resolveProjectPath(cwd, cliOptions.agentsDir ?? DEFAULT_INIT_AGENTS_DIR, "agents-dir");
  const toolsDir = resolveProjectPath(cwd, cliOptions.toolsDir ?? DEFAULT_INIT_TOOLS_DIR, "tools-dir");

  const options: ResolvedInitOptions = {
    interactive: deps.isTty && !cliOptions.yes,
    requestedProvider: cliOptions.provider as any,
    force: !!cliOptions.force,
    strict: !!cliOptions.strict,
    runSmokeTest: !!cliOptions.runSmokeTest,
    smokeReport: cliOptions.report || "pretty",
    cwd,
    workflowsDir,
    agentsDir,
    toolsDir
  };

  if (options.force && options.strict) {
    throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, "Cannot combine --force and --strict.");
  }

  if (cliOptions.provider && !isSupportedInitProvider(cliOptions.provider)) {
    throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, `Unsupported provider: ${cliOptions.provider}`);
  }

  if (cliOptions.report && !options.runSmokeTest) {
    throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, "--report requires --run-smoke-test.");
  }

  // 2. Detect provider candidates
  const candidates = await deps.detectProviders();

  // 3. Resolve provider selection
  let selection: ProviderSelection | "cancel";

  if (!options.interactive) {
    selection = deps.selectProviderNonInteractive({
      requestedProvider: options.requestedProvider as any,
      candidates
    });
  } else {
    if (!options.requestedProvider) {
      selection = await deps.promptProviderSelection({
        stdin: deps.stdin,
        stdout: deps.stdout,
        candidates
      });
    } else {
      const requestedCandidate = candidates.find((c: ProviderCandidate) => c.name === options.requestedProvider);

      if (requestedCandidate?.detected) {
        selection = {
          defaultProvider: requestedCandidate.name,
          requestedProvider: requestedCandidate.name,
          selectedReason: "explicit-detected"
        };
      } else {
        selection = await deps.promptUnavailableRequestedProvider({
          stdin: deps.stdin,
          stdout: deps.stdout,
          requested: options.requestedProvider,
          candidates
        });
      }
    }
  }

  if (selection === "cancel") {
    deps.stdout.write(formatCancellationMessage() + "\n");
    throw new OpenDynamicWorkflowError(ErrorCode.USER_CANCELLED, "Initialization cancelled by user.");
  }

  // 4. Build the init plan
  const plan = await deps.buildInitPlan({
    options,
    providerSelection: selection
  });

  // 5. Fail on strict conflicts or path-kind conflicts before confirmation or writes
  if (plan.strictConflicts && plan.strictConflicts.length > 0) {
    deps.stdout.write(formatStrictConflicts(plan) + "\n");
    throw new OpenDynamicWorkflowError(ErrorCode.CLI_USAGE_ERROR, "Init target paths already exist in strict mode.");
  }

  if (plan.pathConflicts && plan.pathConflicts.length > 0) {
    const firstConflict = plan.pathConflicts[0]!;
    throw new OpenDynamicWorkflowError(ErrorCode.ARTIFACT_WRITE_FAILED, firstConflict.conflictReason!);
  }

  // 6. Confirm the plan when interactive
  if (options.interactive) {
    const confirmed = await deps.confirmInitPlan({
      stdin: deps.stdin,
      stdout: deps.stdout,
      plan
    });
    if (!confirmed) {
      deps.stdout.write(formatCancellationMessage() + "\n");
      throw new OpenDynamicWorkflowError(ErrorCode.USER_CANCELLED, "Initialization cancelled by user.");
    }
  }

  // 7. Apply the plan
  const writeResult = await deps.applyInitPlan(plan);

  // 8. Optionally run the smoke test
  const smokeTestResult = options.runSmokeTest
    ? await deps.runInitSmokeTest({
        cwd: options.cwd,
        workflowPath: path.join(options.workflowsDir, DEFAULT_INIT_EXAMPLE_FILE),
        report: options.smokeReport,
        stdout: deps.stdout,
        stderr: deps.stderr
      })
    : { requested: false, reportMode: options.smokeReport };

  // 9. Print the summary
  const result: InitResult = {
    plan,
    writeResult,
    smokeTest: smokeTestResult as any
  };

  printInitSummary({ result, stdout: deps.stdout, stderr: deps.stderr });

  // 10. Rethrow smoke test error if any to ensure non-zero exit code
  if (smokeTestResult.error) {
    throw smokeTestResult.error as Error;
  }
}
