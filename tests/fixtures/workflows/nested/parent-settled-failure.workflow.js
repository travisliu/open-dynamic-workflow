export const meta = {
  name: "parent-settled-failure",
  description: "Parent that uses settled failure mode"
};

export default async ({ workflow }) => {
  const result = await workflow({
    name: "child-failure",
    failureMode: "settled"
  });
  return { settledResult: result };
};
