import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tenant: 'tenant-a',
  user: { user_id: 'user-a', user_type: 'internal', roles: [] },
  permissions: new Set<string>(),
  allowedProjects: new Set<string>(),
  db: {},
  trx: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) => fn(state.user, { tenant: state.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_user: unknown, resource: string, action: string) =>
    state.permissions.has(`${resource}:${action}`),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: state.db }),
  withTransaction: async (_db: unknown, fn: any) => fn(state.trx),
}));
vi.mock('@alga-psa/authorization/recordCreateAuthorization', () => ({
  assertResourceOperationOpen: vi.fn(),
}));
vi.mock('../lib/projectReadAuthorization', () => ({
  assertProjectReadAllowed: vi.fn(async (_trx: unknown, _tenant: string, _user: unknown, projectId: string) => {
    if (!state.allowedProjects.has(projectId)) throw new Error('Permission denied: Cannot read project');
  }),
}));
vi.mock('@alga-psa/inventory/lib', () => ({
  MaterialValidationError: class extends Error {},
  listMaterials: vi.fn(),
  addMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
  updateProjectMaterialBilling: vi.fn(),
  queryCatalogPickerItems: vi.fn(),
  queryServicePrices: vi.fn(),
  queryAvailableStockUnits: vi.fn(),
}));
vi.mock('@alga-psa/inventory/lib/consume', () => ({
  InsufficientStockError: class extends Error {},
  stockConflictResultFrom: () => null,
}));

import * as inventory from '@alga-psa/inventory/lib';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { assertProjectReadAllowed } from '../lib/projectReadAuthorization';
import {
  addProjectMaterial, deleteProjectMaterial, getServicePrices,
  listAvailableStockUnitsForMaterial, listProjectMaterials,
  searchServiceCatalogForPicker, updateProjectMaterial,
} from './materialCatalogActions';

const input = {
  project_id: 'project-a', client_id: 'client-a', service_id: 'product-a',
  quantity: 1, rate: 100, currency_code: 'USD',
};
const billing = { rate: 200, billing_destination: 'next_project_invoice' as const };
const operations = [
  { name: 'list', run: () => listProjectMaterials('project-a'), service: inventory.listMaterials, args: ['project', 'project-a'] },
  { name: 'add', run: () => addProjectMaterial(input), service: inventory.addMaterial, args: [{ ...input, parent_type: 'project', parent_id: 'project-a' }, state.user.user_id] },
  { name: 'update', run: () => updateProjectMaterial('material-a', billing), service: inventory.updateProjectMaterialBilling, args: ['material-a', billing] },
  { name: 'delete', run: () => deleteProjectMaterial('material-a'), service: inventory.deleteMaterial, args: ['project', 'material-a', state.user.user_id] },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.tenant = 'tenant-a';
  state.permissions = new Set(['project:read', 'project:update', 'inventory:read']);
  state.allowedProjects = new Set(['project-a']);
  // Model the resolver's lookup against records from two tenants. Missing a tenant
  // predicate would expose material-b's parent and let the write reach inventory.
  const rows = [
    { tenant: 'tenant-a', project_material_id: 'material-a', project_id: 'project-a' },
    { tenant: 'tenant-b', project_material_id: 'material-b', project_id: 'project-a' },
  ];
  state.trx.mockImplementation(() => ({
    where: (filter: Record<string, unknown>) => ({
      first: async () => rows.find(row => Object.entries(filter).every(([key, value]) => row[key as keyof typeof row] === value)),
    }),
  }));
});

describe('project material action boundaries', () => {
  it.each(operations)('$name delegates using the authenticated tenant and the authorization transaction', async ({ run, service, args }) => {
    await run();
    expect(assertProjectReadAllowed).toHaveBeenCalledWith(state.trx, state.tenant, state.user, 'project-a');
    expect(service).toHaveBeenCalledExactlyOnceWith(state.trx, state.tenant, ...args);
    expect(vi.mocked(assertProjectReadAllowed).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(service).mock.invocationCallOrder[0]);
  });

  it.each(operations)('$name refuses inaccessible projects before reading or changing materials', async ({ run, service }) => {
    state.allowedProjects.clear();
    expect(isActionPermissionError(await run())).toBe(true);
    expect(service).not.toHaveBeenCalled();
  });

  it.each(operations)('$name refuses callers without coarse permission', async ({ run, service }) => {
    state.permissions.clear();
    expect(isActionPermissionError(await run())).toBe(true);
    expect(assertProjectReadAllowed).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });

  it.each(['update', 'delete'] as const)('%s treats foreign-tenant materials like missing materials', async operation => {
    const run = (id: string) => operation === 'update'
      ? updateProjectMaterial(id, billing) : deleteProjectMaterial(id);
    const missing = await run('missing');
    expect(isActionPermissionError(missing)).toBe(true);
    expect(await run('material-b')).toEqual(missing);
    expect(assertProjectReadAllowed).not.toHaveBeenCalled();
    expect(inventory.updateProjectMaterialBilling).not.toHaveBeenCalled();
    expect(inventory.deleteMaterial).not.toHaveBeenCalled();
  });

  it('returns the material data supplied by inventory for an authorized read', async () => {
    const materials = [{ project_material_id: 'material-a', ...input }];
    vi.mocked(inventory.listMaterials).mockResolvedValueOnce(materials as any);
    expect(await listProjectMaterials('project-a')).toEqual(materials);
  });

  it.each(['tenant-a', 'tenant-b'])('passes authenticated scope through all catalog reads for %s', async tenant => {
    state.tenant = tenant;
    const options = { search: 'cable', item_kinds: ['product' as const] };
    vi.mocked(inventory.queryCatalogPickerItems).mockResolvedValueOnce({ items: [], totalCount: 0 });
    await searchServiceCatalogForPicker(options);
    await getServicePrices('product-a');
    await listAvailableStockUnitsForMaterial('product-a');
    expect(inventory.queryCatalogPickerItems).toHaveBeenCalledExactlyOnceWith(state.trx, tenant, options);
    expect(inventory.queryServicePrices).toHaveBeenCalledExactlyOnceWith(state.trx, tenant, 'product-a');
    expect(inventory.queryAvailableStockUnits).toHaveBeenCalledExactlyOnceWith(state.trx, tenant, 'product-a');
  });
});
