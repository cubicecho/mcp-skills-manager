import { errorMessage } from '../errors.ts';

/**
 * Close something during teardown, logging a failure instead of throwing it.
 * @param closable - The transport, server or session to close.
 * @param label - What is being closed, for the warning (e.g. `MCP transport`).
 * @returns A promise that settles once the close has finished or failed; it never rejects.
 */
export function closeQuietly(closable: { close(): Promise<void> }, label: string): Promise<void> {
  return closable.close().catch((err: unknown) => console.warn(`${label} close failed: ${errorMessage(err)}`));
}
