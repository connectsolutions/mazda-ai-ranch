/** Human-readable byte count for tables and previews; `-` when unknown. */
export function formatBytes(size: number | null): string {
  if (size === null) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
