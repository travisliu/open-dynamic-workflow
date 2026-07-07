export const meta = ({
  name: "Static Wrapper Workflow",
  description: "Static wrapper workflow",
  tags: ["regression"] as const,
  inputSchema: ({ type: "object" } as const)
} satisfies Record<string, unknown>);

export default async function workflow() {
  throw new Error("list must not execute workflow body");
}
