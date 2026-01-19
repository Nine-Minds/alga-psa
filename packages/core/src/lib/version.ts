// Client-safe version utility
// Import server package.json to get version at build time
import packageJson from '../../../../server/package.json';

export function getAppVersion(): string {
  return packageJson.version || 'unknown';
}

