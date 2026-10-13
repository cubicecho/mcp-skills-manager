import { errorMessage } from './errors.ts';

/** One thing to close on the way out, named for the log. */
export interface ShutdownStep {
  /** Names the step in the log line of a failed close. */
  label: string;
  /** Closes it; a returned promise is awaited before the next step. */
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

/** The signals that start a shutdown. */
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Closes everything, in order, on the first SIGTERM or SIGINT, then exits 0.
 *
 * @param steps - What to close, first to last.
 * @param host - Where to listen, log and exit.
 *
 * @remarks
 * A step that fails is logged and the rest still run; a second signal while closing is ignored.
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
