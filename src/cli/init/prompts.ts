import * as readline from "node:readline/promises";
import { ProviderCandidate, ProviderSelection, InitPlan } from "./types.js";

export interface PromptInput {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WritableStream;
}

export async function promptProviderSelection({ stdin, stdout, candidates }: PromptInput & { candidates: ProviderCandidate[] }): Promise<ProviderSelection | "cancel"> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  stdout.write("Detected provider CLIs:\n");
  candidates.forEach(c => {
    const status = c.detected ? "✓" : "✕";
    stdout.write(`  ${status} ${c.name.padEnd(12)} ${c.command || ""}\n`);
  });
  stdout.write("\n");

  const recommendation = candidates.find(c => c.detected && !c.builtIn)?.name || "mock";
  stdout.write(`Recommended default provider: ${recommendation}\n`);

  const options = candidates.map(c => c.name);
  const prompt = `Choose a default provider (${options.join("/")}) [${recommendation}] or 'c' to cancel: `;

  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    rl.close();

    if (answer === "c" || answer === "cancel") return "cancel";
    if (answer === "") return { defaultProvider: recommendation, selectedReason: "interactive-choice" };

    const selected = candidates.find(c => c.name === answer);
    if (selected) {
      return {
        defaultProvider: selected.name,
        selectedReason: "interactive-choice"
      };
    }

    stdout.write(`Invalid selection: ${answer}. Falling back to recommendation.\n`);
    return { defaultProvider: recommendation, selectedReason: "interactive-choice" };
  } catch (err) {
    rl.close();
    return "cancel";
  }
}

export async function promptUnavailableRequestedProvider({ stdin, stdout, requested, candidates }: PromptInput & { requested: string; candidates: ProviderCandidate[] }): Promise<ProviderSelection | "cancel"> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  stdout.write(`Warning: requested provider "${requested}" was not found in PATH.\n`);
  const prompt = `Options: (1) Continue with ${requested} anyway, (2) Switch to mock, (c) Cancel: `;

  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    rl.close();

    if (answer === "1") return {
      defaultProvider: requested as any,
      requestedProvider: requested as any,
      selectedReason: "explicit-undetected-interactive-continue"
    };
    if (answer === "2") return {
      defaultProvider: "mock",
      requestedProvider: requested as any,
      selectedReason: "interactive-choice"
    };
    return "cancel";
  } catch (err) {
    rl.close();
    return "cancel";
  }
}

export async function confirmInitPlan({ stdin, stdout, plan }: PromptInput & { plan: InitPlan }): Promise<boolean> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  stdout.write("\nOpenFlow will create:\n");
  plan.targets.forEach(t => {
    if (t.action === "create" || t.action === "overwrite") {
      stdout.write(`  ${t.displayPath}\n`);
    }
  });

  stdout.write(`\nDefault provider: ${plan.providerSelection.defaultProvider}\n`);
  stdout.write("Existing files will be skipped.\n");
  stdout.write("Package scripts will not be modified.\n");

  try {
    const answer = (await rl.question("\nContinue? (y/n) [y]: ")).trim().toLowerCase();
    rl.close();
    return answer === "" || answer === "y" || answer === "yes";
  } catch (err) {
    rl.close();
    return false;
  }
}
