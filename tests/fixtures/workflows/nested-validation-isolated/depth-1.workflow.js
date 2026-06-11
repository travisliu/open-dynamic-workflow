export const meta = {
  name: "depth-1",
  description: "depth 1"
};

export default async ({ workflow }) => {
  return await workflow({ name: "depth-2" });
};
