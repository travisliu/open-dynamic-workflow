export const meta = {
  name: "root-calls-child",
  description: "Root calling child-echo"
};

const result = await workflow({
  name: "child-echo",
  args: { target: "src/auth.ts" }
});

return result;
