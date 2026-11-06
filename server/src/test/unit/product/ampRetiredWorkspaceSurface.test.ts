import { withCoManagedExportAdmin } from '@alga-psa/co-managed/exportAuthorization';
import { describe, expect, it } from 'vitest';
import { collectApiRoutes, collectMspPageRoutes } from './support/appRouteInventory';

const retiredPackageEntries = [
  '@alga-psa/co-managed/portableWorkspaceExport',
  '@alga-psa/co-managed/portableWorkspaceRestore',
  '@alga-psa/co-managed/portableArchive',
];
const retiredRoute = /portable|(?:^|\/)(?:restore[^/]*workspace|workspace[^/]*restore)(?:\/|$)/i;

describe('retired workspace archive surface', () => {
  it('resolves the current ESM export and does not expose retired package entry points', () => {
    expect(withCoManagedExportAdmin).toBeTypeOf('function');
    expect(import.meta.resolve('@alga-psa/co-managed/exportAuthorization')).toContain(
      'exportAuthorization.ts',
    );

    for (const entry of retiredPackageEntries) {
      expect(() => import.meta.resolve(entry), entry).toThrow(
        expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }),
      );
    }
  });

  it('does not register a retired export or restore route in the App Router', () => {
    const apiRoutes = collectApiRoutes();
    const pageRoutes = collectMspPageRoutes();
    expect(apiRoutes).toContain('/api/co-management/export');
    expect(pageRoutes).toContain('/msp/co-management/export');

    const registeredRoutes = [...apiRoutes, ...pageRoutes];
    expect(registeredRoutes.filter(route => retiredRoute.test(route))).toEqual([]);
  });
});
