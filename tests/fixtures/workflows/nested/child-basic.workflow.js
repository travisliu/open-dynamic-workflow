export const meta = {
  name: "child-basic",
  description: "Simple child workflow"
};

export default async () => {
  return { childEcho: args.message };
};
