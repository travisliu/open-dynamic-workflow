import type { OpenFlowConfig } from "./types.js";

export const DEFAULT_CONFIG: OpenFlowConfig = {
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
      args: ["--output-format", "json", "--approval-mode", "plan"],
      defaultModel: "gemini-3-flash-preview",
      promptMode: "stdin"
    },
    opencode: {
      command: "opencode",
      args: ["run", "--format", "json"],
      defaultModel: null,
      modelArg: { flag: "--model" },
      promptMode: "arg",
      permissionPolicy: "read-only"
    },
    antigravity: {
      command: "agy",
      args: [],
      defaultModel: null,
      modelArg: { flag: "--model" },
      promptMode: "arg",
      promptFlag: "-p",
      sandboxFlag: "--sandbox",
      dangerouslySkipPermissionsFlag: "--dangerously-skip-permissions",
      useSandboxByDefault: true,
      permissionPolicy: "sandbox"
    },
    pi: {
      command: "pi",
      executionMode: "json",
      defaultModel: null,
      modelArg: { flag: "--model" },
      promptMode: "arg",
      safeTools: ["read", "grep", "find", "ls"],
      fullAccessTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
      noSession: true,
      noContextFiles: true,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      approvalMode: "no-approve",
      deterministicEnv: true
    }
  },
  security: {
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
  sharedAgents: {
    dir: ".openflow/agents",
    allowDynamicIds: false,
    maxDefinitions: 100,
    strictPromptTemplateVariables: true
  },
  tools: {
    dir: ".openflow/tools",
    concurrency: 4,
    maxDefinitions: 100
  },
  workflow: {
    discovery: {
      include: ["workflows/**/*.ts"]
    },
    maxDepth: 8
  },
  reporting: {
    mode: "pretty",
    verbose: false
  }
};
