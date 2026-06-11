export const meta = {
  name: "parent-invalid-args",
  description: "Calls child with invalid args"
};

export default async ({ workflow, args }) => {
  // Use args from input to bypass discovery-time static validation
  return await workflow({
    name: "child-schema",
    args: { count: args.invalidCount }
  });
};
