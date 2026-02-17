/**
 * Derives the sync server HTTP URL from environment variables.
 * Uses SYNC_SERVER_INTERNAL_URL (Docker/prod) or derives from NEXT_PUBLIC_SYNC_URL.
 */
export function getSyncHttpUrl(): string {
  // Docker/prod: explicit internal URL
  if (process.env.SYNC_SERVER_INTERNAL_URL) {
    return process.env.SYNC_SERVER_INTERNAL_URL;
  }
  // Dev: derive from the public WebSocket URL
  const wsUrl = process.env.NEXT_PUBLIC_SYNC_URL || 'ws://localhost:4444';
  return wsUrl.replace(/^ws(s?):/, 'http$1:');
}
