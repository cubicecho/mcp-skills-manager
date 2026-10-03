/**
 * Format a byte count for display.
 * @param bytes - The size in bytes.
 * @returns The size in B, KB or MB (1 KB = 1024 B), to one decimal place from 1 KB up.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format a count with its noun, pluralised with an `s`.
 * @param count - How many there are.
 * @param noun - The singular noun, e.g. `file`.
 * @returns The count and noun, e.g. `1 file` or `3 files`.
 */
export function formatCount(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Format a duration for display, to its two largest units.
 * @param seconds - The duration in seconds.
 * @returns The duration, e.g. `42s`, `5m`, `3h 12m` or `2d 4h`.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Format an ISO timestamp as a medium-length local date.
 * @param iso - The timestamp.
 * @returns The date, e.g. `Oct 3, 2026`, or an empty string when the timestamp does not parse.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
