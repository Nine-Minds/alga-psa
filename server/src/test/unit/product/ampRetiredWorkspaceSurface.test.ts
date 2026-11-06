import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { collectApiRoutes, collectMspPageRoutes } from './support/appRouteInventory';

const require = createRequire(import.meta.url);
const retiredPackageEntries = [
  '@alga-psa/co-managed/portableWorkspaceExport',
  '@alga-psa/co-managed/portableWorkspaceRestore',
  '@alga-psa/co-managed/portableArchive',
];
const retiredRoute = /portable|(?:^|\/)(?:restore[^/]*workspace|workspace[^/]*restore)(?:\/|$)/i;

describe('retired workspace archive surface', () => {
  it('does not expose retired package entry points to runtime consumers', () => {
    for (const entry of retiredPackageEntries) {
      expect(() => require.resolve(entry), entry).toThrow(/not defined by.*exports|not found|cannot find/i);
    }
  });

  it('does not register a retired export or restore route in the App Router', () => {
    const registeredRoutes = [...collectApiRoutes(), ...collectMspPageRoutes()];
    expect(registeredRoutes.filter(route => retiredRoute.test(route))).toEqual([]);
  });
});
