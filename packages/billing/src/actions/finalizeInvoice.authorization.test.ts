import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTenantKnex, hasPermission, validateInvoiceFinalization, validateInvoiceFinalizationInternal } = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  hasPermission: vi.fn(),
  validateInvoiceFinalization: vi.fn(),
  validateInvoiceFinalizationInternal: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (action: unknown) => action }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex,
  tenantDb: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock('./taxSourceActions', () => ({
  validateInvoiceFinalization,
  validateInvoiceFinalizationInternal,
}));

import { createTenantKnex as createTenantKnexMock } from '@alga-psa/db';
import { hasPermission as hasPermissionMock } from '@alga-psa/auth/rbac';
import { validateInvoiceFinalization as validateEngineEntry } from './taxSourceActions';
import { finalizeInvoice } from './invoiceModification';

const updateOnlyUser = { user_id: 'update-only', grants: new Set(['invoice:update']) };
const finalizeCapableUser = {
  user_id: 'finalize-capable',
  grants: new Set(['invoice:update', 'invoice:finalize']),
};

describe('finalizeInvoice authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermissionMock).mockImplementation(async (user: any, resource: string, action: string) =>
      user.grants.has(`${resource}:${action}`),
    );
    vi.mocked(createTenantKnexMock).mockResolvedValue({ knex: {} } as any);
    // The engine entry has been reached. Stop there so this test remains about
    // the exported action's authorization boundary, not finalization behavior.
    vi.mocked(validateEngineEntry).mockResolvedValue({ canFinalize: false, error: 'engine reached' } as any);
  });

  it('denies an authenticated update-only user before entering the finalization engine', async () => {
    const result = await (finalizeInvoice as any)(updateOnlyUser, { tenant: 'tenant-1' }, 'invoice-1');

    expect(result).toMatchObject({
      permissionError: 'Permission denied: invoice finalize required',
      messageKey: 'msp/invoicing:errors.permissions.invoiceFinalize',
    });
    expect(hasPermissionMock).toHaveBeenCalledWith(updateOnlyUser, 'invoice', 'finalize');
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(validateEngineEntry).not.toHaveBeenCalled();
  });

  it('admits a finalize-capable user and reaches the finalization engine', async () => {
    await (finalizeInvoice as any)(finalizeCapableUser, { tenant: 'tenant-1' }, 'invoice-1');

    expect(hasPermissionMock).toHaveBeenCalledWith(finalizeCapableUser, 'invoice', 'finalize');
    expect(createTenantKnexMock).toHaveBeenCalledOnce();
    expect(validateEngineEntry).toHaveBeenCalledWith('invoice-1');
  });
});
