import { defineTool } from "@travisliu/open-dynamic-workflow";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const OUTPUT_LIMIT = 80_000;
const ISSUE_LINE_LIMIT = 160;
const FAILURE_DETAIL_LIMIT = 8_000;
const require = createRequire(import.meta.url);
const TSC_BIN = require.resolve("typescript/bin/tsc");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function tail(text, limit = OUTPUT_LIMIT) {
  const value = String(text ?? "");
  return value.length <= limit ? value : value.slice(value.length - limit);
}

function stripAnsi(value) {
  return String(value ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}

function collectVitestJsonIssueCandidates(displayCommand, report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return [];
  }

  const testResults = Array.isArray(report.testResults) ? report.testResults : [];
  const candidates = [];

  for (const fileResult of testResults) {
    const file =
      typeof fileResult?.name === "string"
        ? fileResult.name
        : typeof fileResult?.testFilePath === "string"
          ? fileResult.testFilePath
          : "";

    const assertionResults = Array.isArray(fileResult?.assertionResults)
      ? fileResult.assertionResults
      : [];

    for (const assertion of assertionResults) {
      if (assertion?.status !== "failed") {
        continue;
      }

      const ancestorTitles = Array.isArray(assertion.ancestorTitles)
        ? assertion.ancestorTitles.filter(value => typeof value === "string")
        : [];

      const title =
        typeof assertion.title === "string"
          ? assertion.title
          : typeof assertion.fullName === "string"
            ? assertion.fullName
            : "";

      const testName = [...ancestorTitles, title].filter(Boolean).join(" > ");

      const failureMessages = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages.filter(value => typeof value === "string")
        : [];

      const details = tail(
        failureMessages.map(stripAnsi).join("\n\n"),
        FAILURE_DETAIL_LIMIT
      );

      candidates.push({
        command: displayCommand,
        source: "json",
        kind: "vitest-failed-case",
        file,
        testName,
        text: testName
          ? `Vitest failed case: ${file} > ${testName}`
          : `Vitest failed case: ${file}`,
        details
      });
    }
  }

  return dedupeIssueCandidates(candidates);
}

function collectEslintJsonIssueCandidates(displayCommand, report) {
  if (!Array.isArray(report)) {
    return [];
  }

  const candidates = [];

  for (const fileResult of report) {
    const file = typeof fileResult?.filePath === "string" ? fileResult.filePath : "";

    const messages = Array.isArray(fileResult?.messages)
      ? fileResult.messages
      : [];

    for (const message of messages) {
      const severity =
        message?.severity === 2
          ? "error"
          : message?.severity === 1
            ? "warning"
            : "unknown";

      const ruleId =
        typeof message?.ruleId === "string"
          ? message.ruleId
          : message?.ruleId === null
            ? null
            : undefined;

      const line = Number.isFinite(message?.line) ? message.line : undefined;
      const column = Number.isFinite(message?.column) ? message.column : undefined;

      const location =
        line && column
          ? `${file}:${line}:${column}`
          : line
            ? `${file}:${line}`
            : file;

      const messageText =
        typeof message?.message === "string"
          ? stripAnsi(message.message)
          : "ESLint reported an issue.";

      candidates.push({
        command: displayCommand,
        source: "json",
        kind: "eslint-lint-message",
        severity,
        ruleId,
        file,
        line,
        column,
        text: ruleId
          ? `${location} ${severity} ${ruleId}: ${messageText}`
          : `${location} ${severity}: ${messageText}`,
        details: JSON.stringify(
          {
            message: messageText,
            ruleId,
            severity,
            line,
            column,
            endLine: message?.endLine,
            endColumn: message?.endColumn,
            nodeType: message?.nodeType,
            fixable: Boolean(message?.fix)
          },
          null,
          2
        )
      });
    }
  }

  return dedupeIssueCandidates(candidates);
}

function collectTypeScriptIssueCandidates(displayCommand, stdout, stderr) {
  const candidates = [];

  for (const entry of [
    { source: "stdout", text: stdout },
    { source: "stderr", text: stderr }
  ]) {
    const lines = String(entry.text ?? "")
      .split(/\r?\n/)
      .map(line => stripAnsi(line).trim())
      .filter(Boolean);

    for (const line of lines) {
      const locationMatch = /^(.*)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line);

      if (locationMatch) {
        const [, file, lineNumber, columnNumber, severity, code, message] = locationMatch;

        candidates.push({
          command: displayCommand,
          source: entry.source,
          kind: "typescript-compile-diagnostic",
          severity,
          code,
          file,
          line: Number(lineNumber),
          column: Number(columnNumber),
          text: line,
          details: JSON.stringify(
            {
              message,
              code,
              severity,
              file,
              line: Number(lineNumber),
              column: Number(columnNumber)
            },
            null,
            2
          )
        });
        continue;
      }

      const genericMatch = /^(error|warning) (TS\d+): (.*)$/.exec(line);

      if (genericMatch) {
        const [, severity, code, message] = genericMatch;

        candidates.push({
          command: displayCommand,
          source: entry.source,
          kind: "typescript-compile-diagnostic",
          severity,
          code,
          text: line,
          details: JSON.stringify(
            {
              message,
              code,
              severity
            },
            null,
            2
          )
        });
      }
    }
  }

  return dedupeIssueCandidates(candidates);
}

function dedupeIssueCandidates(candidates) {
  const seen = new Set();
  const deduped = [];

  for (const candidate of candidates) {
    const key = [
      candidate.kind,
      candidate.command,
      candidate.source,
      candidate.file ?? "",
      candidate.line ?? "",
      candidate.column ?? "",
      candidate.ruleId ?? "",
      candidate.code ?? "",
      candidate.testName ?? "",
      candidate.text
    ].join("\u0000");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped.slice(0, ISSUE_LINE_LIMIT);
}

async function runCommand(name, command, args, cwd, signal) {
  const startedAt = Date.now();
  const displayCommand = `${command} ${args.join(" ")}`;

  return await new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", chunk => {
      stdout = tail(stdout + chunk);
    });

    child.stderr.on("data", chunk => {
      stderr = tail(stderr + chunk);
    });

    child.on("error", error => {
      const errorText = `${error.name}: ${error.message}`;
      const combinedOutput = tail(`${stdout}\n${stderr}\n${errorText}`.trim());

      resolve({
        name,
        command,
        args,
        displayCommand,
        status: "error",
        exitCode: null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: tail(`${stderr}\n${errorText}`.trim()),
        combinedOutput,
        issueCandidates: []
      });
    });

    child.on("close", exitCode => {
      const normalizedExitCode = exitCode ?? 1;
      const status = normalizedExitCode === 0 ? "succeeded" : "failed";
      const combinedOutput = tail(`${stdout}\n${stderr}`.trim());

      resolve({
        name,
        command,
        args,
        displayCommand,
        status,
        exitCode: normalizedExitCode,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        combinedOutput,
        issueCandidates: []
      });
    });
  });
}

async function runTestCommandWithVitestJson(command, cwd, signal) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "odw-vitest-"));
  const reportPath = path.join(tempDir, "vitest-report.json");

  try {
    const result = await runCommand(
      "test",
      command,
      [
        "test",
        "--",
        "--reporter=json",
        `--outputFile=${reportPath}`,
        "--no-color"
      ],
      cwd,
      signal
    );

    let jsonCandidates = [];

    try {
      const rawReport = await readFile(reportPath, "utf8");
      const parsedReport = JSON.parse(rawReport);
      jsonCandidates = collectVitestJsonIssueCandidates(
        result.displayCommand,
        parsedReport
      );
    } catch {
      // Ignore stdout/stderr diagnostics for tests and rely on the Vitest JSON report.
    }

    return {
      ...result,
      issueCandidates: dedupeIssueCandidates(jsonCandidates)
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runLintCommandWithJson(command, cwd, signal) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "odw-eslint-"));
  const reportPath = path.join(tempDir, "eslint-report.json");

  try {
    const jsonResult = await runCommand(
      "lint",
      command,
      [
        "run",
        "lint",
        "--",
        "--format=json",
        `--output-file=${reportPath}`
      ],
      cwd,
      signal
    );

    let jsonCandidates = [];

    try {
      const rawReport = await readFile(reportPath, "utf8");
      const parsedReport = JSON.parse(rawReport);
      jsonCandidates = collectEslintJsonIssueCandidates(
        jsonResult.displayCommand,
        parsedReport
      );
    } catch {
      // Ignore stdout/stderr diagnostics for lint and rely on the ESLint JSON report.
    }

    return {
      ...jsonResult,
      issueCandidates: dedupeIssueCandidates(jsonCandidates)
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runBuildCommandWithTscDiagnostics(command, cwd, signal) {
  const displayCommand = "tsc --pretty false";
  const result = await runCommand(
    "build",
    command,
    [TSC_BIN, "--pretty", "false"],
    cwd,
    signal
  );

  const tscCandidates = collectTypeScriptIssueCandidates(
    displayCommand,
    result.stdout,
    result.stderr
  );

  return {
    ...result,
    command: "tsc",
    args: ["--pretty", "false"],
    displayCommand,
    issueCandidates: dedupeIssueCandidates(tscCandidates)
  };
}

const commandResultSchema = {
  type: "object",
  properties: {
    name: { type: "string", enum: ["test", "lint", "build"] },
    command: { type: "string" },
    args: {
      type: "array",
      items: { type: "string" }
    },
    displayCommand: { type: "string" },
    status: {
      type: "string",
      enum: ["succeeded", "failed", "error"]
    },
    exitCode: { type: ["number", "null"] },
    durationMs: { type: "number" },
    stdout: { type: "string" },
    stderr: { type: "string" },
    combinedOutput: { type: "string" },
    issueCandidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          command: { type: "string" },
          source: {
            type: "string",
            enum: ["stdout", "stderr", "json"]
          },
          kind: {
            type: "string",
            enum: [
              "vitest-failed-case",
              "eslint-lint-message",
              "typescript-compile-diagnostic"
            ]
          },
          severity: {
            type: "string",
            enum: ["error", "warning", "unknown"]
          },
          ruleId: {
            type: ["string", "null"]
          },
          code: { type: "string" },
          file: { type: "string" },
          line: { type: "number" },
          column: { type: "number" },
          testName: { type: "string" },
          text: { type: "string" },
          details: { type: "string" }
        },
        required: ["command", "source", "kind", "text"],
        additionalProperties: false
      }
    }
  },
  required: [
    "name",
    "command",
    "args",
    "displayCommand",
    "status",
    "exitCode",
    "durationMs",
    "stdout",
    "stderr",
    "combinedOutput",
    "issueCandidates"
  ],
  additionalProperties: false
};

export default defineTool({
  id: "npm-quality-gate",
  description:
    "Run npm test, npm run lint, and tsc --pretty false, returning structured command results for downstream issue extraction.",
  inputSchema: {
    type: "object",
    properties: {
      cwd: {
        type: "string",
        description: "Working directory. Defaults to the current project directory."
      },
      continueOnFailure: {
        type: "boolean",
        description:
          "If false, stop after the first failed command. If true, run all commands and report every failure."
      }
    },
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      status: { type: "string", enum: ["passed", "failed"] },
      cwd: { type: "string" },
      failedCommand: { type: ["string", "null"] },
      stopReason: { type: "string", enum: ["completed", "failed-command"] },
      summary: { type: "string" },
      test: {
        type: ["object", "null"],
        properties: commandResultSchema.properties,
        required: commandResultSchema.required,
        additionalProperties: false
      },
      lint: {
        type: ["object", "null"],
        properties: commandResultSchema.properties,
        required: commandResultSchema.required,
        additionalProperties: false
      },
      build: {
        type: ["object", "null"],
        properties: commandResultSchema.properties,
        required: commandResultSchema.required,
        additionalProperties: false
      }
    },
    required: [
      "ok",
      "status",
      "cwd",
      "failedCommand",
      "stopReason",
      "summary",
      "test",
      "lint",
      "build"
    ],
    additionalProperties: false
  },
  defaultTimeoutMs: 900_000,
  run: async (input, context) => {
    const cwd = input.cwd ? path.resolve(input.cwd) : process.cwd();
    const continueOnFailure = input.continueOnFailure === true;
    const npm = npmCommand();

    context.log("Starting npm quality gate", {
      cwd,
      continueOnFailure,
      commands: [
        `${npm} test -- --reporter=json --outputFile=<temp-file> --no-color`,
        `${npm} run lint -- --format=json --output-file=<temp-file>`,
        "tsc --pretty false"
      ]
    });

    const test = await runTestCommandWithVitestJson(npm, cwd, context.signal);
    context.log("Completed npm command", {
      command: test.displayCommand.replace(/--outputFile=\S+/g, "--outputFile=<temp-file>"),
      status: test.status,
      exitCode: test.exitCode,
      durationMs: test.durationMs
    });

    let lint = null;
    if (continueOnFailure || test.status === "succeeded") {
      lint = await runLintCommandWithJson(npm, cwd, context.signal);
      context.log("Completed npm command", {
        command: lint.displayCommand.replace(/--output-file=\S+/g, "--output-file=<temp-file>"),
        status: lint.status,
        exitCode: lint.exitCode,
        durationMs: lint.durationMs
      });
    }

    let build = null;
    if (continueOnFailure || (test.status === "succeeded" && lint?.status === "succeeded")) {
      build = await runBuildCommandWithTscDiagnostics(process.execPath, cwd, context.signal);
      context.log("Completed npm command", {
        command: build.displayCommand,
        status: build.status,
        exitCode: build.exitCode,
        durationMs: build.durationMs
      });
    }

    const failed = [test, lint, build].find(result => result?.status !== "succeeded") ?? null;
    const ok = failed === null;

    return {
      ok,
      status: ok ? "passed" : "failed",
      cwd,
      failedCommand: failed?.displayCommand ?? null,
      stopReason: ok ? "completed" : "failed-command",
      summary: ok
        ? "npm test, npm run lint, and tsc --pretty false all passed."
        : `Quality gate failed at ${failed?.displayCommand}. Use test/lint/build.issueCandidates to extract fixable issues.`,
      test,
      lint,
      build
    };
  }
});
