export interface ToolRuntimeGlobalLock {
  runExclusive<T>(operation: () => Promise<T> | T): Promise<T>;
}

export function createToolRuntimeGlobalLock(): ToolRuntimeGlobalLock {
  let tail = Promise.resolve();
  return {
    runExclusive<T>(operation: () => Promise<T> | T): Promise<T> {
      const start = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      return start.then(async () => {
        try { return await operation(); }
        finally { release(); }
      });
    }
  };
}

export const toolRuntimeGlobalLock = createToolRuntimeGlobalLock();
