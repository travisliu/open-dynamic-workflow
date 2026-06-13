import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { main } from "../../src/cli/index.js";

const SECURITY_FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures/listing/security");
const AGENT_MARKER = path.join(process.cwd(), "agent-side-effect.marker");
const TOOL_MARKER = path.join(process.cwd(), "tool-side-effect.marker");
const WORKFLOW_MARKER = path.join(process.cwd(), "workflow-side-effect.marker");

describe("list-command security", () => {
  beforeEach(() => {
    if (fs.existsSync(AGENT_MARKER)) fs.unlinkSync(AGENT_MARKER);
    if (fs.existsSync(TOOL_MARKER)) fs.unlinkSync(TOOL_MARKER);
    if (fs.existsSync(WORKFLOW_MARKER)) fs.unlinkSync(WORKFLOW_MARKER);
  });

  afterEach(() => {
    if (fs.existsSync(AGENT_MARKER)) fs.unlinkSync(AGENT_MARKER);
    if (fs.existsSync(TOOL_MARKER)) fs.unlinkSync(TOOL_MARKER);
    if (fs.existsSync(WORKFLOW_MARKER)) fs.unlinkSync(WORKFLOW_MARKER);
  });

  it("does not execute top-level code in workflows during listing", async () => {
    await main(["node", "openflow", "list", "workflows", "--cwd", SECURITY_FIXTURES_DIR]);

    expect(fs.existsSync(WORKFLOW_MARKER)).toBe(false);
  });

  it("does not execute top-level code in agents during listing", async () => {
    await main(["node", "openflow", "list", "agents", "--cwd", SECURITY_FIXTURES_DIR]);
    
    expect(fs.existsSync(AGENT_MARKER)).toBe(false);
  });

  it("does not execute top-level code in tools during listing", async () => {
    await main(["node", "openflow", "list", "tools", "--cwd", SECURITY_FIXTURES_DIR]);
    
    expect(fs.existsSync(TOOL_MARKER)).toBe(false);
  });
});
