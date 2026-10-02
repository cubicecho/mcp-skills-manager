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
