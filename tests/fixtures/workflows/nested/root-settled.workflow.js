export const meta = {
  name: "root-settled",
  description: "Root calling failing child in settled mode"
};

const result = await workflow({
  name: "child-fails",
  failureMode: "settled"
});

return { childStatus: result.status };
