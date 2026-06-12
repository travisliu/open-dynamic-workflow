export type ReleaseFn = () => void;

export class ToolLimiter {
  private activeCount = 0;
  private queue: { resolve: (release: ReleaseFn) => void; reject: (err: any) => void; signal: AbortSignal }[] = [];

  constructor(private readonly limit: number) {
    if (limit <= 0) {
      throw new Error("Concurrency limit must be at least 1.");
    }
  }

  async acquire(signal: AbortSignal): Promise<ReleaseFn> {
    if (signal.aborted) {
      throw signal.reason || new Error("Aborted");
    }

    if (this.activeCount < this.limit) {
      this.activeCount++;
      return this.createRelease();
    }

    return new Promise<ReleaseFn>((resolve, reject) => {
      const onAbort = () => {
        const index = this.queue.findIndex(item => item.signal === signal);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(signal.reason || new Error("Aborted"));
        }
      };

      signal.addEventListener("abort", onAbort, { once: true });

      this.queue.push({
        resolve: (release) => {
          signal.removeEventListener("abort", onAbort);
          resolve(release);
        },
        reject: (err) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        },
        signal
      });
    });
  }

  private createRelease(): ReleaseFn {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount--;
      this.pump();
    };
  }

  private pump(): void {
    while (this.activeCount < this.limit && this.queue.length > 0) {
      const { resolve, signal } = this.queue.shift()!;
      if (signal.aborted) {
        continue;
      }
      this.activeCount++;
      resolve(this.createRelease());
    }
  }
}
