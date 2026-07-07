import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { main } from "../../src/cli/index.js";

const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures/listing/static-values-regression");

async function captureListReport(resourceType: "tools" | "agents" | "workflows") {
  let output = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((msg: any) => {
    output += msg;
    return true;
  });

  try {
    await main([
      "node",
      "open-dynamic-workflow",
      "list",
      resourceType,
      "--cwd",
      FIXTURE_DIR,
      "--report",
      "json",
    ]);

    return JSON.parse(output);
  } finally {
    spy.mockRestore();
  }
}

describe("discovery-static-values-regression integration", () => {
  beforeEach(() => {
    process.exitCode = 0;
  });

  it("lists tools from static fixtures without executing the tool body", async () => {
    // Arrange
    const expectedInputSchema = {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    };

    // Act
    const parsed = await captureListReport("tools");
    const tool = parsed.resources.find((resource: any) => resource.id === "static-wrapper.tool");

    // Assert
    expect(parsed.status).toBe("succeeded");
    expect(tool).toBeDefined();
    expect(tool.description).toBe("Static wrapper tool");
    expect(tool.defaultTimeoutMs).toBe(1000);
    expect(tool.inputSchema).toEqual(expectedInputSchema);
  });

  it("lists agents from static fixtures and preserves metadata keys", async () => {
    // Arrange
    const expectedInputSchema = {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    };

    // Act
    const parsed = await captureListReport("agents");
    const agent = parsed.resources.find((resource: any) => resource.id === "static-wrapper.agent");

    // Assert
    expect(parsed.status).toBe("succeeded");
    expect(agent).toBeDefined();
    expect(agent.description).toBe("Static wrapper agent");
    expect(agent.inputSchema).toEqual(expectedInputSchema);
    expect(agent.metadata.category).toBe("regression");
    expect(Object.prototype.hasOwnProperty.call(agent.metadata, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(agent.metadata, "__proto__")?.value).toEqual({ polluted: true });
  });

  it("lists workflows from static fixtures and unwraps wrapper metadata", async () => {
    // Arrange
    const expectedInputSchema = { type: "object" };

    // Act
    const parsed = await captureListReport("workflows");
    const workflow = parsed.resources.find((resource: any) => resource.name === "Static Wrapper Workflow");

    // Assert
    expect(parsed.status).toBe("succeeded");
    expect(workflow).toBeDefined();
    expect(workflow.description).toBe("Static wrapper workflow");
    expect(workflow.tags).toEqual(["regression"]);
    expect(workflow.inputSchema).toEqual(expectedInputSchema);
  });
});
