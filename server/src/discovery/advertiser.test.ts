import { describe, expect, it, vi } from 'vitest';
import { createAdvertiser } from './advertiser.ts';

/**
 * An advertiser over a fake announcer, with the setting under the test's control.
 * @returns The advertiser, the setting, and the fakes to inspect.
 */
function setup() {
  const setting = { on: false };
  const stop = vi.fn(async () => undefined);
  const start = vi.fn(async () => ({ stop }));
  const log = vi.fn();
  const advertiser = createAdvertiser({
    isWanted: () => setting.on,
    name: 'MCP Skills on nas',
    port: 3000,
    log,
    start,
  });
  return { advertiser, setting, start, stop, log };
}

describe('createAdvertiser', () => {
  it('announces nothing while the setting is off', async () => {
    const { advertiser, start } = setup();
    await advertiser.sync();
    expect(start).not.toHaveBeenCalled();
  });

  it('starts when the setting turns on, once, and stops when it turns off', async () => {
    const { advertiser, setting, start, stop } = setup();
    setting.on = true;
    await advertiser.sync();
    await advertiser.sync();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ name: 'MCP Skills on nas', port: 3000 }));
    setting.on = false;
    await advertiser.sync();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('never runs two announcements at once, even when a sync arrives mid-start', async () => {
    const { advertiser, setting, start, stop } = setup();
    let finishStart: () => void = () => undefined;
    start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStart = () => resolve({ stop });
        }),
    );
    setting.on = true;
    const first = advertiser.sync();
    const second = advertiser.sync();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    finishStart();
    await Promise.all([first, second]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('acts on the setting as it is when a queued sync runs', async () => {
    const { advertiser, setting, start } = setup();
    setting.on = true;
    const first = advertiser.sync();
    setting.on = false;
    await Promise.all([first, advertiser.sync()]);
    expect(start).not.toHaveBeenCalled();
  });

  it('logs a failed announcement, carries on, and tries again on the next sync', async () => {
    const { advertiser, setting, start, log } = setup();
    start.mockRejectedValueOnce(new Error('the name may already be in use'));
    setting.on = true;
    await advertiser.sync();
    expect(log).toHaveBeenCalledWith('LAN discovery: could not advertise: the name may already be in use');
    await advertiser.sync();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('stops on close, whatever the setting says', async () => {
    const { advertiser, setting, stop } = setup();
    setting.on = true;
    await advertiser.sync();
    await advertiser.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
