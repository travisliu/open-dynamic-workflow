// @ts-ignore
import { defineAgent } from "@prmflow/openflow";

const agentId = "static-wrapper.agent" as const;
const agentDescription = ("Static wrapper agent") satisfies string;
const metadata = ({ category: "regression", "__proto__": { polluted: true } } as const);
const inputSchema = ({
  type: "object",
  required: ["name"],
  properties: { name: { type: "string" } }
} satisfies Record<string, unknown>);

export default defineAgent({
  id: agentId,
  description: agentDescription,
  metadata: metadata,
  inputSchema: inputSchema,
  run: async () => ({ ok: true })
});
