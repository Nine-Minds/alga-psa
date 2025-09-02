// Client-safe version utility
export function getAppVersion(): string {
  // Use NEXT_PUBLIC_ prefixed environment variable for client-side access
  return process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';
}