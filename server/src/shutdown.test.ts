import { describe, expect, it, vi } from 'vitest';
import { closeOnSignal, type ShutdownHost } from './shutdown.ts';

/**
 * Builds a host that records what closeOnSignal does with it.
 * @returns The host, a way to send it a signal, and its log lines.
 */
function fakeHost() {
  const listeners = new Map<string, (signal: NodeJS.Signals) => void>();
  const lines: string[] = [];
  const exit = vi.fn();
  const host: ShutdownHost = {
    on: (signal, listener) => listeners.set(signal, listener),
    exit,
    log: (message) => lines.push(message),
  };
  const send = (signal: NodeJS.Signals) => listeners.get(signal)?.(signal);
  return { host, send, lines, exit };
}

describe('closeOnSignal', () => {
  it('closes every step in order on SIGTERM or SIGINT, then exits 0', async () => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const { host, send, exit } = fakeHost();
      const closed: string[] = [];
      closeOnSignal(
        [
          { label: 'first', close: async () => closed.push('first') },
          { label: 'second', close: () => closed.push('second') },
        ],
        host,
      );
      send(signal);
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(closed).toEqual(['first', 'second']);
    }
  });

  it('logs a step that fails and still runs the rest', async () => {
    const { host, send, lines, exit } = fakeHost();
    const last = vi.fn();
    closeOnSignal(
      [
        { label: 'sessions', close: () => Promise.reject(new Error('socket gone')) },
        { label: 'store', close: last },
      ],
      host,
    );
    send('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(last).toHaveBeenCalledOnce();
    expect(lines).toContain('Shutdown error (sessions): socket gone');
  });

  it('ignores a second signal while it is closing', async () => {
    const { host, send, exit } = fakeHost();
    const close = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 20)));
    closeOnSignal([{ label: 'slow', close }], host);
    send('SIGINT');
    send('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });
});
