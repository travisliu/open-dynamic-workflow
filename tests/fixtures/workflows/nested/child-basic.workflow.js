export const meta = {
  name: "child-basic",
  description: "Simple child workflow"
};

export default async ({ args }) => {
  return { childEcho: args.message };
};
