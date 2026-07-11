import * as fs from "node:fs/promises";

export async function acquireLock(lockPath: string, timeoutMs = 120000, retryIntervalMs = 500) {
  const start = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockPath);
      return; // Lock acquired successfully
    } catch (err: any) {
      if (err.code !== "EEXIST") {
        throw err;
      }
      const stats = await fs.stat(lockPath).catch(() => null);
      if (stats && Date.now() - stats.mtimeMs > 180000) { // 3 minutes
        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timeout acquiring lock at ${lockPath}`);
      }
      await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
    }
  }
}

export async function releaseLock(lockPath: string) {
  await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
}
