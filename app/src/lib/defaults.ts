// Every value in the UI someone might tune, as plain data. Nothing here computes or imports.

/** How often the UI re-reads live data. */
export interface PollingSettings {
  /** Server status in the sidebar and settings page, in ms. */
  statusMs: number;
  /** The skill and workspace lists, in ms. */
  listMs: number;
}

/** The polling intervals the query hooks use. */
export const POLLING_DEFAULTS: Readonly<PollingSettings> = Object.freeze({
  statusMs: 15_000,
  listMs: 10_000,
});

/** How many times a failed query is tried again before its error is shown. */
export const QUERY_RETRIES = 2;
