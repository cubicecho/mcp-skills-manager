import { type Advertisement, type AdvertiseOptions, advertise } from '@cubicecho/mcp-discovery/mdns';
import { errorMessage } from '../errors.ts';

/** What the advertiser needs from the process. */
export interface AdvertiserDeps {
  /** Whether the server should be announced; read on every `sync`, so it follows `settings.lanAdvertise`. */
  isWanted: () => boolean;
  /** The instance name people see when browsing, e.g. `MCP Skills on nas`. */
  name: string;
  /** The HTTP port the server listens on. */
  port: number;
  /** Writes a line to the log. */
  log: (message: string) => void;
  /**
   * Starts an announcement; replaced in tests.
   *
   * @defaultValue the mDNS `advertise` from `@cubicecho/mcp-discovery/mdns`
   */
  start?: (options: AdvertiseOptions) => Promise<Advertisement>;
}

/** Keeps the mDNS announcement in step with the setting. */
export interface Advertiser {
  /** Starts or stops the announcement to match `isWanted()`. */
  sync: () => Promise<void>;
  /** Stops the announcement, if any; call on shutdown so browsers drop the server at once. */
  close: () => Promise<void>;
}

/**
 * Builds the advertiser; nothing is announced until the first `sync`.
 *
 * @param deps - The setting, name, port, log and optionally the announcer.
 * @returns The advertiser.
 *
 * @remarks
 * Calls are queued, so a quick on-off-on never runs two announcements. An announcement that fails (the name is
 * taken, or multicast is blocked) is logged and the server carries on; the next `sync` tries again.
 */
export function createAdvertiser(deps: AdvertiserDeps): Advertiser {
  const start = deps.start ?? advertise;
  let current: Advertisement | null = null;
  let queue: Promise<void> = Promise.resolve();

  const stop = async (): Promise<void> => {
    if (!current) {
      return;
    }
    const stopping = current;
    current = null;
    await stopping.stop();
    deps.log('LAN discovery: stopped advertising');
  };

  const apply = async (): Promise<void> => {
    const isWanted = deps.isWanted();
    if (isWanted && current === null) {
      try {
        current = await start({ name: deps.name, port: deps.port, onError: (error) => deps.log(error.message) });
        deps.log(`LAN discovery: advertising "${deps.name}" on port ${deps.port}`);
      } catch (error) {
        deps.log(`LAN discovery: could not advertise: ${errorMessage(error)}`);
      }
      return;
    }
    if (isWanted === false) {
      await stop();
    }
  };

  const enqueue = (step: () => Promise<void>): Promise<void> => {
    queue = queue.then(step, step);
    return queue;
  };

  return {
    sync: () => enqueue(apply),
    close: () => enqueue(stop),
  };
}
