import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderExampleWorkflow } from "../../../src/cli/init/renderer.js";

const projectRoot = process.cwd();

function readText(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), "utf8");
}

function findLines(text: string, phrase: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.includes(phrase));
}

function expectNegativeProse(text: string, phrase: string): void {
  const lines = findLines(text, phrase);
  expect(lines.length, `Expected to find ${phrase} in unsupported prose`).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line.toLowerCase()).toMatch(/unsupported|invalid|do not|does not|unavailable/);
  }
}

function expectBefore(text: string, first: string, second: string): void {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  expect(firstIndex, `Expected to find ${first}`).toBeGreaterThanOrEqual(0);
  expect(secondIndex, `Expected to find ${second}`).toBeGreaterThanOrEqual(0);
  expect(firstIndex).toBeLessThan(secondIndex);
}

describe("Phase 4 acceptance: documentation and template refactoring", () => {
  it("documents the run-scoped global context model consistently and keeps the phase gate explicit", () => {
    // Arrange
    const readme = readText("README.md");
    const referenceIndex = readText("skills/open-dynamic-workflow/references/README.md");
    const apiDocument = readText("skills/open-dynamic-workflow/references/api-document.md");
    const skill = readText("skills/open-dynamic-workflow/SKILL.md");
    const acceptancePlan = readText("plans/global-context/documentation-and-template-refactoring/acceptance-tests.md");

    // Act
    const docs = { readme, referenceIndex, apiDocument, skill, acceptancePlan };

    // Assert
    expect(docs.readme).toContain("Each workflow run receives exactly one JSON-safe global `context` store");
    expect(docs.readme).toContain("Distinction between global `context` and callback `ctx`");
    expect(docs.referenceIndex).toContain(
      "Defines the run-scoped global `context` binding and its distinction from operational callback `ctx`"
    );
    expect(docs.apiDocument).toContain("single run-scoped global state store");
    expect(docs.apiDocument).toContain("Default Export Workflow Functions");
    expect(docs.apiDocument).toContain("The only argument to `parallel()` is the collection of task thunks");
    expect(findLines(docs.apiDocument, "PipelineStageContext").some((line) => line.includes("has no") && line.includes("context") && line.includes("field"))).toBe(true);
    expect(findLines(docs.apiDocument, "LoopRoundContext").some((line) => line.includes("has no") && line.includes("context") && line.includes("field"))).toBe(true);
    expect(docs.apiDocument).toContain("`ctx.agent()`");
    expect(docs.apiDocument).toContain("`ctx.workflow()`");
    expect(docs.apiDocument).toContain("The property `ctx.context` is completely unsupported");
    expect(docs.skill).toContain("Use the JSON-safe, run-scoped global `context` binding for workflow state.");
    expect(docs.skill).toContain("Default export functions receive no context parameter");
    expect(docs.skill).toContain("Use `ctx.agent()` and `ctx.workflow()` inside loop round callbacks.");
    expect(docs.skill).toContain("Do not access context-store fields on callback objects");
    expect(docs.skill).toContain("Do not provide context configuration options to DSL primitives");
    expect(docs.acceptancePlan).toContain("npm run typecheck");
    expect(docs.acceptancePlan).toContain("npm run lint");
    expect(docs.acceptancePlan).toContain("npm run build");
    expect(docs.acceptancePlan).toContain("npm test");
  });

  it("keeps the phase-owned examples and templates on direct global context while preserving operational ctx helpers", () => {
    // Arrange
    const mockReview = readText("examples/mock-review.js");
    const parallelReview = readText("examples/parallel-review.js");
    const basicTemplate = readText("skills/open-dynamic-workflow/assets/basic-workflow.template.js");
    const parallelTemplate = readText("skills/open-dynamic-workflow/assets/parallel-workflow.template.js");
    const pipelineTemplate = readText("skills/open-dynamic-workflow/assets/pipeline-workflow.template.js");
    const loopTemplate = readText("skills/open-dynamic-workflow/assets/loop-workflow.template.js");
    const toolTemplate = readText("skills/open-dynamic-workflow/assets/tool-workflow.template.js");

    // Act
    const phaseSurfaces = [
      { name: "mock review example", text: mockReview },
      { name: "parallel review example", text: parallelReview },
      { name: "basic template", text: basicTemplate },
      { name: "parallel template", text: parallelTemplate },
      { name: "pipeline template", text: pipelineTemplate },
      { name: "loop template", text: loopTemplate }
    ];

    // Assert
    expect(phaseSurfaces[0].text).toContain('context.set("review.input"');
    expect(phaseSurfaces[0].text).toContain("const reviews = await parallel({");
    expect(phaseSurfaces[0].text).toContain("context: context.snapshot()");
    expectBefore(phaseSurfaces[0].text, 'context.set("review.input"', "const reviews = await parallel({");
    expect(phaseSurfaces[0].text).not.toContain("ctx.context");
    expect(phaseSurfaces[0].text).not.toContain("workflow({ context:");

    expect(phaseSurfaces[1].text).toContain('context.set("review.input"');
    expect(phaseSurfaces[1].text).toContain("const reviews = await parallel({");
    expect(phaseSurfaces[1].text).toContain("context: context.snapshot()");
    expectBefore(phaseSurfaces[1].text, 'context.set("review.input"', "const reviews = await parallel({");
    expect(phaseSurfaces[1].text).not.toContain("ctx.context");
    expect(phaseSurfaces[1].text).not.toContain("workflow({ context:");

    expect(phaseSurfaces[2].text).toContain('context.set("status", "running")');
    expect(phaseSurfaces[2].text).toContain("finalStatus: context.get(\"status\")");
    expectBefore(phaseSurfaces[2].text, 'context.set("status", "running")', "const result = await agent({");
    expect(phaseSurfaces[2].text).not.toContain("ctx.context");
    expect(phaseSurfaces[2].text).not.toContain("workflow({ context:");

    expect(phaseSurfaces[3].text).toContain('context.set("reviewType", "code-and-security")');
    expect(phaseSurfaces[3].text).toContain("const reviews = await parallel({");
    expect(phaseSurfaces[3].text).toContain("context: context.snapshot()");
    expectBefore(phaseSurfaces[3].text, 'context.set("reviewType", "code-and-security")', "const reviews = await parallel({");
    expect(phaseSurfaces[3].text).not.toContain("ctx.context");
    expect(phaseSurfaces[3].text).not.toContain("workflow({ context:");

    expect(phaseSurfaces[4].text).toContain('context.set("pipeline-started", true)');
    expect(phaseSurfaces[4].text).toContain("run: (item, ctx) =>");
    expect(phaseSurfaces[4].text).toContain("ctx.agent({");
    expect(phaseSurfaces[4].text).toContain("context.set(`item-status:${item}`, \"analyzing\")");
    expect(phaseSurfaces[4].text).toContain("context: context.snapshot()");
    expectBefore(phaseSurfaces[4].text, 'context.set("pipeline-started", true)', "const itemResults = await pipeline(");
    expect(phaseSurfaces[4].text).not.toContain("ctx.context");
    expect(phaseSurfaces[4].text).not.toContain("pipeline(..., { context:");

    expect(phaseSurfaces[5].text).toContain("run: async (state, ctx) =>");
    expect(phaseSurfaces[5].text).toContain("ctx.agent({");
    expect(phaseSurfaces[5].text).toContain("ctx.agentId(\"review\")");
    expect(phaseSurfaces[5].text).toContain('context.append("round-history"');
    expect(phaseSurfaces[5].text).toContain('history: context.get("round-history")');
    expect(phaseSurfaces[5].text).not.toContain("ctx.context");
    expect(phaseSurfaces[5].text).not.toContain("loop({ context:");

    // Assertions for migrated no-import defineTool example
    expect(toolTemplate).toContain("export default defineTool(");
    expect(toolTemplate).not.toContain("@travisliu/open-dynamic-workflow");
    expect(toolTemplate).not.toContain("context.set");
    expect(toolTemplate).not.toContain("context.get");
    expect(toolTemplate).not.toContain("context.snapshot");
    expect(toolTemplate).not.toContain("phase(");
    expect(toolTemplate).not.toContain("agent(");
    expect(toolTemplate).not.toContain("tool(");
  });

  it("renders the init starter with direct global context and no retired forms", () => {
    // Arrange
    const rendererSource = readText("src/cli/init/renderer.ts");
    const renderedStarter = renderExampleWorkflow();

    // Act
    const starterBundle = { rendererSource, renderedStarter };

    // Assert
    expect(starterBundle.rendererSource).toContain('context.set("projectName", "starter-project")');
    expect(starterBundle.rendererSource).toContain('projectName: context.get("projectName")');
    expectBefore(starterBundle.rendererSource, 'context.set("projectName", "starter-project")', "const result = await agent({");
    expect(starterBundle.rendererSource).not.toContain("ctx.context");
    expect(starterBundle.renderedStarter).toContain("export const meta =");
    expect(starterBundle.renderedStarter).toContain('phase("run")');
    expect(starterBundle.renderedStarter).toContain('context.set("projectName", "starter-project")');
    expect(starterBundle.renderedStarter).toContain('projectName: context.get("projectName")');
    expect(starterBundle.renderedStarter).toContain("await agent({");
    expectBefore(starterBundle.renderedStarter, 'context.set("projectName", "starter-project")', "const result = await agent({");
    expect(starterBundle.renderedStarter).not.toContain("provider:");
    expect(starterBundle.renderedStarter).not.toContain("ctx.context");
    expect(starterBundle.renderedStarter).not.toContain("workflow({ context:");
  });

  it("keeps retired context forms confined to unsupported prose in the reference docs", () => {
    // Arrange
    const apiDocument = readText("skills/open-dynamic-workflow/references/api-document.md");
    const skill = readText("skills/open-dynamic-workflow/SKILL.md");

    // Act
    const negativeProseDocs = { apiDocument, skill };

    // Assert
    expectNegativeProse(negativeProseDocs.apiDocument, "ctx.context");
    expectNegativeProse(negativeProseDocs.apiDocument, "context` options");
    expectNegativeProse(negativeProseDocs.skill, "ctx.context");
    expectNegativeProse(negativeProseDocs.skill, "context configuration options");
  });

  it("documents OdwToolExecutionContext properties and does not claim cwd is part of it", () => {
    const apiDocument = readText("skills/open-dynamic-workflow/references/api-document.md");
    
    // Assert it contains the supported properties
    expect(apiDocument).toContain("OdwToolExecutionContext");
    expect(apiDocument).toContain("runId");
    expect(apiDocument).toContain("toolCallId");
    expect(apiDocument).toContain("definitionId");
    expect(apiDocument).toContain("workflowInvocationId");
    expect(apiDocument).toContain("parentWorkflowInvocationId");
    expect(apiDocument).toContain("artifactsDir");
    expect(apiDocument).toContain("signal");
    expect(apiDocument).toContain("log(message, data?)");
    
    // Assert it does not claim cwd is part of OdwToolExecutionContext
    const contextSection = apiDocument.slice(apiDocument.indexOf("OdwToolExecutionContext"));
    const endOfSection = contextSection.indexOf("---");
    const sectionText = contextSection.slice(0, endOfSection > 0 ? endOfSection : 2000);
    
    expect(sectionText).not.toContain("cwd");
  });
});
