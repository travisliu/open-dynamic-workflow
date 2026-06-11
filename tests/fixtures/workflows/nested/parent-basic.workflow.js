export const meta = {
  name: "parent-basic",
  description: "Parent workflow that calls a child"
};

export default async ({ workflow, args }) => {
  const result = await workflow({
    name: "child-basic",
    args: { message: args.message || "hello from parent" }
  });
  return { parentReceived: result };
};
