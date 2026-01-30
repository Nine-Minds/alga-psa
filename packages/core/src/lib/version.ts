// Client-safe version utility
// Import package.json to get version at build time
import packageJson from '../../package.json';

export function getAppVersion(): string {
  // Use package.json version which is available at build time
  // Environment variable override still supported for Helm deployments
  return process.env.NEXT_PUBLIC_APP_VERSION ||
    packageJson.version ||
    'dev';
}

