/**
 * QuickBooks REST surface permission contract.
 *
 * Every QuickBooks endpoint used to gate on `quickbooks:read/write/admin` — a
 * resource no migration ever seeds — so Admin + Finance users got a 403
 * ("Cannot read quickbooks") on every call (issue #3769). The endpoints must
 * gate on the seeded `accounting_integrations` capabilities instead, with the
 * action chosen per endpoint class: reads use `catalog_read`, connection
 * lifecycle uses `connections_manage`, mapping writes use `mappings_manage`
 * and sync/export execution uses `exports_execute`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const permissionProbe = vi.hoisted(() => ({
  calls: [] as Array<{ resource: string; action: string }>,
  granted: new Set<string>(),
}));

vi.mock('../../../lib/api/middleware/apiContextPermission', () => ({
  hasApiContextPermission: async (_context: unknown, resource: string, action: string) => {
    permissionProbe.calls.push({ resource, action });
    return permissionProbe.granted.has(`${resource}:${action}`);
  },
}));

// checkPermission only needs a connection handle to pass to the RBAC lookup,
// which is mocked above; keep the rest of the db module real.
vi.mock('../../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getConnection: async () => ({}) as unknown,
}));

import { ApiQuickBooksController } from '../../../lib/api/controllers/ApiQuickBooksController';

type Handler = () => (req: NextRequest) => Promise<Response>;

const CATALOG_READ = 'catalog_read';
const CONNECTIONS_MANAGE = 'connections_manage';
const MAPPINGS_MANAGE = 'mappings_manage';
const EXPORTS_EXECUTE = 'exports_execute';

/** Every controller endpoint and the capability it must request. */
const ENDPOINT_ACTIONS: Array<[keyof ApiQuickBooksController, string]> = [
  // Reads: Admin + Finance (accounting_integrations:catalog_read).
  ['getConnectionStatus', CATALOG_READ],
  ['testConnection', CATALOG_READ],
  ['getCustomerMappings', CATALOG_READ],
  ['getAccounts', CATALOG_READ],
  ['getAccountMappings', CATALOG_READ],
  ['getTaxCodes', CATALOG_READ],
  ['getTaxMappings', CATALOG_READ],
  ['getSyncStatus', CATALOG_READ],
  ['getSyncHistory', CATALOG_READ],
  ['getSyncStatusById', CATALOG_READ],
  ['getDataMappings', CATALOG_READ],
  ['getDataMappingById', CATALOG_READ],
  ['getHealth', CATALOG_READ],
  ['getHealthConfig', CATALOG_READ],
  ['getItems', CATALOG_READ],
  ['getPaymentMethods', CATALOG_READ],
  ['getTerms', CATALOG_READ],

  // Connection lifecycle: Admin only (was gated on 'admin'/'write').
  ['initiateOAuth', CONNECTIONS_MANAGE],
  ['handleOAuthCallback', CONNECTIONS_MANAGE],
  ['disconnectOAuth', CONNECTIONS_MANAGE],
  ['refreshConnection', CONNECTIONS_MANAGE],
  ['updateHealthConfig', CONNECTIONS_MANAGE],
  ['runDiagnostics', CONNECTIONS_MANAGE],

  // Mapping writes: Admin + Finance.
  ['deleteCustomerMapping', MAPPINGS_MANAGE],
  ['configureAccountMappings', MAPPINGS_MANAGE],
  ['configureTaxMappings', MAPPINGS_MANAGE],
  ['createDataMapping', MAPPINGS_MANAGE],
  ['updateDataMapping', MAPPINGS_MANAGE],
  ['deleteDataMapping', MAPPINGS_MANAGE],

  // Sync/export execution: Admin + Finance.
  ['syncCustomers', EXPORTS_EXECUTE],
  ['exportInvoices', EXPORTS_EXECUTE],
  ['importInvoices', EXPORTS_EXECUTE],
  ['syncPayments', EXPORTS_EXECUTE],
  ['cancelSync', EXPORTS_EXECUTE],
  ['retrySync', EXPORTS_EXECUTE],
  ['bulkSync', EXPORTS_EXECUTE],
  ['fullSync', EXPORTS_EXECUTE],
];

/** The six endpoints the reporter called, by path, with the handler each binds. */
const REPORTED_ENDPOINTS: Array<[string, keyof ApiQuickBooksController, string]> = [
  ['GET /api/v1/quickbooks/connection/status', 'getConnectionStatus', CATALOG_READ],
  ['GET /api/v1/integrations/quickbooks/connection/status', 'getConnectionStatus', CATALOG_READ],
  ['GET /api/v1/quickbooks/sync/status', 'getSyncStatus', CATALOG_READ],
  ['GET /api/v1/quickbooks/mappings', 'getDataMappings', CATALOG_READ],
  ['GET /api/v1/integrations/quickbooks/items', 'getItems', CATALOG_READ],
  ['GET /api/v1/integrations/quickbooks/tax-codes', 'getTaxCodes', CATALOG_READ],
];

function buildController(): ApiQuickBooksController {
  const controller = new ApiQuickBooksController();
  vi.spyOn(controller as any, 'authenticate').mockImplementation(async (req: any) => {
    req.context = {
      tenant: 'tenant-qbo',
      userId: 'user-qbo',
      viaPrincipalUserId: null,
      user: { tenant: 'tenant-qbo', user_id: 'user-qbo', user_type: 'internal' },
    };
    return req;
  });
  return controller;
}

async function invoke(
  method: keyof ApiQuickBooksController,
  init: { url?: string; body?: unknown } = {},
): Promise<Response> {
  const controller = buildController();
  const handler = (controller[method] as unknown as Handler).call(controller);
  return handler(new NextRequest(init.url ?? 'http://localhost/api/v1/quickbooks/mappings/mapping-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(init.body ?? {}),
  }));
}

describe('QuickBooks endpoints request seeded accounting_integrations permissions', () => {
  beforeEach(() => {
    permissionProbe.calls.length = 0;
    permissionProbe.granted.clear();
    vi.restoreAllMocks();
  });

  it.each(ENDPOINT_ACTIONS)('%s checks accounting_integrations:%s', async (method, action) => {
    const response = await invoke(method);

    expect(permissionProbe.calls).toEqual([{ resource: 'accounting_integrations', action }]);
    // Permission withheld, so the endpoint must stop at the gate.
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', message: `Permission denied: Cannot ${action} accounting integrations` },
    });
  });

  it.each(REPORTED_ENDPOINTS)('%s (issue #3769) checks accounting_integrations:%s', async (_path, method, action) => {
    await invoke(method);

    expect(permissionProbe.calls).toEqual([{ resource: 'accounting_integrations', action }]);
  });

  it('never asks for the unseeded quickbooks resource', async () => {
    for (const [method] of ENDPOINT_ACTIONS) {
      permissionProbe.calls.length = 0;
      await invoke(method);
      expect(permissionProbe.calls.map((call) => call.resource)).toEqual(['accounting_integrations']);
    }
  });

  it('lets a holder of the mapped capability past the gate', async () => {
    // One read and one mapping write: granting exactly the mapped capability is
    // enough, and no endpoint falls back to a second permission check.
    permissionProbe.granted.add(`accounting_integrations:${CATALOG_READ}`);
    const read = await invoke('getSyncStatus', { url: 'http://localhost/api/v1/quickbooks/sync/status' });
    expect(read.status).toBe(200);

    permissionProbe.calls.length = 0;
    permissionProbe.granted.clear();
    permissionProbe.granted.add(`accounting_integrations:${MAPPINGS_MANAGE}`);
    const write = await invoke('createDataMapping', {
      url: 'http://localhost/api/v1/quickbooks/mappings',
      body: {
        entity_type: 'customer',
        mapping_name: 'contract-test',
        field_mappings: [{ alga_field: 'client_name', qbo_field: 'DisplayName' }],
      },
    });
    expect(write.status).toBe(201);
    expect(permissionProbe.calls).toEqual([
      { resource: 'accounting_integrations', action: MAPPINGS_MANAGE },
    ]);
  });

  it('keeps catalog_read holders out of connection administration', async () => {
    permissionProbe.granted.add(`accounting_integrations:${CATALOG_READ}`);
    const response = await invoke('disconnectOAuth');

    expect(response.status).toBe(403);
    expect(permissionProbe.calls).toEqual([
      { resource: 'accounting_integrations', action: CONNECTIONS_MANAGE },
    ]);
  });
});
