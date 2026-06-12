export const meta = {
  name: "tool-invalid-parallel",
  description: "A workflow that calls a tool inside parallel() which is invalid"
};

export default async ({ tool, parallel }) => {
  await parallel([
    async () => {
      await tool({
        definition: "read-json",
        args: { path: "package.json" }
      });
    }
  ]);
};
