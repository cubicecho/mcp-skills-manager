import { errorMessage } from './errors.ts';

/** One thing to close on the way out, named for the log. */
export interface ShutdownStep {
  label: string;
  close: () => unknown;
}

/** Where {@link closeOnSignal} listens, logs and exits; replaced in tests. */
export interface ShutdownHost {
  /** Registers a signal listener. */
  on: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  /** Ends the process. */
  exit: (code: number) => unknown;
  /** Writes a line. The stdio server must pass stderr: stdout is its MCP channel. */
  log: (message: string) => void;
}

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Close everything, in order, on the first SIGTERM or SIGINT, then exit 0. A step that fails is
 * logged and the rest still run; a second signal while closing is ignored.
 * @param steps - What to close, first to last.
 * @param host - Where to listen, log and exit.
 */
export function closeOnSignal(steps: ShutdownStep[], host: ShutdownHost): void {
  let isClosing = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isClosing) {
      return;
    }
    isClosing = true;
    host.log(`Received ${signal}; shutting down`);
    for (const step of steps) {
      try {
        await step.close();
      } catch (err) {
        host.log(`Shutdown error (${step.label}): ${errorMessage(err)}`);
      }
    }
    host.exit(0);
  };
  for (const signal of SHUTDOWN_SIGNALS) {
    host.on(signal, (received) => void shutdown(received));
  }
}
