export const meta = {
  name: "Workflow",
  description: "Parallel execution and global concurrency limit"
};

let results;
if (args.subcase === "04.01") {
  results = await parallel({
    agent1: () => agent({ id: "agent1", provider: "mock", prompt: "Task 1" }),
    agent2: () => agent({ id: "agent2", provider: "mock", prompt: "Task 2" }),
    agent3: () => agent({ id: "agent3", provider: "mock", prompt: "Task 3" })
  });
} else if (args.subcase === "04.02") {
  results = await parallel({
    agent1: () => agent({ provider: "mock", prompt: "Agent 1 prompt", label: "agent1" }),
    agent2: () => agent({ provider: "mock", prompt: "Agent 2 prompt", label: "agent2" }),
    agent3: () => agent({ provider: "mock", prompt: "Agent 3 prompt", label: "agent3" }),
    agent4: () => agent({ provider: "mock", prompt: "Agent 4 prompt", label: "agent4" }),
    agent5: () => agent({ provider: "mock", prompt: "Agent 5 prompt", label: "agent5" })
  });
} else if (args.subcase === "04.03") {
  results = await parallel({
    "success-quick": () => agent({ label: "success-quick", provider: "mock", prompt: "Quick success" }),
    "fail-quick": () => agent({ label: "fail-quick", provider: "mock", prompt: "Quick failure" }),
    "success-slow": () => agent({ label: "success-slow", provider: "mock", prompt: "Slow success" })
  });
} else if (args.subcase === "04.04") {
  results = await parallel({
    agent1: () => agent({ id: "agent-default", provider: "mock", prompt: "Task default" }),
    agent2: () => agent({ id: "agent-full-access", provider: "mock", prompt: "Task full access", permissions: { mode: "dangerously-full-access" } })
  });
}

export default (args.subcase === "04.01" || args.subcase === "04.04") ? { results } : results;
