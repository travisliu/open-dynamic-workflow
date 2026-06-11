export const meta = {
  name: "child-timeout",
  description: "Child that times out"
};

// Wait for a long time (simulated)
await new Promise(resolve => setTimeout(resolve, 10000));

return { done: true };
