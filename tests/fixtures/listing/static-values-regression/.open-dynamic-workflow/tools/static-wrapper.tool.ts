// @ts-ignore
import { defineTool } from "@prmflow/openflow";

const toolId = "static-wrapper.tool" as const;
const toolDescription = ("Static wrapper tool") satisfies string;
const schemaFragment = ({ name: { type: "string" } } as const);
const inputSchema = {
  type: "object",
  required: ["name"],
  properties: schemaFragment
} as const;
const metadata = ({ category: "regression", "__proto__": { polluted: true } } as const);
const timeoutMs = (1000 as const);

export default defineTool({
  id: toolId,
  description: toolDescription,
  inputSchema: inputSchema,
  metadata: metadata,
  defaultTimeoutMs: timeoutMs,
  run: async () => {
    throw new Error("list must not execute tool run");
  }
});
