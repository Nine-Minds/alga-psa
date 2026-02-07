// Client-safe version utility
// Prefer explicit runtime env configuration. npm_package_version is available in many local dev contexts.
const PACKAGE_VERSION = process.env.npm_package_version;

export function getAppVersion(): string {
  // Environment variable override is preferred for deployments.
  return process.env.NEXT_PUBLIC_APP_VERSION ||
    PACKAGE_VERSION ||
    'dev';
}
