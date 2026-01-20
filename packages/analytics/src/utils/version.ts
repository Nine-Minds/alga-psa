// Client-safe version utility
// Version is provided via environment variable set during build

export function getAppVersion(): string {
  // NEXT_PUBLIC_APP_VERSION should be set at build time
  // Falls back to npm_package_version for server-side or 'dev' for local development
  return process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.npm_package_version ||
    'dev';
}
