// Client-safe version utility
// Import package.json to get version at build time
import packageJson from '../../../../server/package.json';

export function getAppVersion(): string {
  // Use package.json version which is available at build time
  // This works for both client and server side
  return packageJson.version || 'unknown';
}
