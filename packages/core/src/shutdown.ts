import type { Logger } from "pino";

export interface ShutdownStep {
  name: string;
  run: () => Promise<unknown>;
}

export interface ShutdownOptions {
  log: Logger;
  timeoutMs: number;
  steps: ShutdownStep[];
  // Runs only if the steps do not finish in time, just before a forced exit.
  onTimeout?: () => Promise<void>;
}

export function installGracefulShutdown(opts: ShutdownOptions): void {
  let shuttingDown = false;

  const begin = (signal: string) => {
    if (shuttingDown) {
      opts.log.warn({ signal }, "shutdown already in progress, waiting for it to finish");
      return;
    }
    shuttingDown = true;
    opts.log.info({ signal, timeoutMs: opts.timeoutMs }, "shutdown requested");

    const forceTimer = setTimeout(async () => {
      opts.log.error({ timeoutMs: opts.timeoutMs }, "shutdown timed out, forcing exit");
      try {
        await opts.onTimeout?.();
      } catch (err) {
        opts.log.error({ err }, "shutdown timeout hook failed");
      }
      process.exit(1);
    }, opts.timeoutMs);

    void (async () => {
      for (const step of opts.steps) {
        try {
          await step.run();
          opts.log.info({ step: step.name }, "shutdown step done");
        } catch (err) {
          opts.log.error({ err, step: step.name }, "shutdown step failed");
        }
      }
      clearTimeout(forceTimer);
      opts.log.info("shutdown complete");
      process.exit(0);
    })();
  };

  process.on("SIGINT", () => begin("SIGINT"));
  process.on("SIGTERM", () => begin("SIGTERM"));
}