import type { ExecflowConfig } from "./types.js";

export const DEFAULT_CONFIG: ExecflowConfig = {
  defaultProvider: "mock",
  concurrency: 4,
  timeoutMs: 900_000,
  providers: {
    mock: {
      command: "mock",
      args: [],
      defaultModel: null,
      responses: {
        default: { text: "mock response" }
      }
    },
    codex: {
      command: "codex",
      args: ["exec", "--json", "--ephemeral"],
      defaultModel: null
    },
    gemini: {
      command: "gemini",
      args: ["--output-format", "json"],
      defaultModel: "gemini-2.5-flash"
    }
  },
  security: {
    allowShell: false,
    allowWorkflowImports: false,
    passEnv: [],
    redactEnv: [
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "*_KEY",
      "*_TOKEN",
      "*_SECRET",
      "PASSWORD"
    ]
  },
  reporting: {
    mode: "pretty",
    verbose: false
  }
};
