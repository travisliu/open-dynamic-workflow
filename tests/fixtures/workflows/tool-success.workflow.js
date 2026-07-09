export const meta = {
  name: "tool-success",
  description: "A workflow that calls a tool successfully"
};

export default async () => {
  const result = await tool({
    definition: "read-json",
    args: { path: "package.json" }
  });
  return result;
};
