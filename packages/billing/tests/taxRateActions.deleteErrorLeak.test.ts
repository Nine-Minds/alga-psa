import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnex = vi.fn();
const deleteEntityWithValidation = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnex(...args),
  tenantDb: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: (...args: any[]) => deleteEntityWithValidation(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(() => true),
}));

vi.mock('@shared/services/productAccessGuard', () => ({
  assertPsaOnlyTenantAccess: vi.fn(async () => undefined),
  ProductAccessError: class ProductAccessError extends Error {},
}));

async function loadDeleteTaxRate() {
  const mod = await import('../src/actions/taxRateActions');
  return mod.deleteTaxRate;
}

describe('deleteTaxRate error handling', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnex.mockResolvedValue({ knex: vi.fn() });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('T034: an unmapped database error never leaks SQL to the client', async () => {
    // Shape of a real Knex/Postgres failure: the interpolated statement is
    // prefixed onto the message, and DeleteEntityDialog renders `message` verbatim.
    const dbError: any = new Error(
      'delete from "tax_components" where "tax_rate_id" = \'rate-a\' - update or delete on table "tax_components" violates foreign key constraint "composite_tax_mappings_tax_component_id_foreign" on table "composite_tax_mappings"'
    );
    dbError.code = '23503x';
    deleteEntityWithValidation.mockRejectedValue(dbError);

    const deleteTaxRate = await loadDeleteTaxRate();
    const result: any = await deleteTaxRate('rate-a');

    expect(result.success).toBe(false);
    expect(result.canDelete).toBe(false);
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.message).toBe('Failed to delete tax rate. Please refresh and try again.');
    expect(result.message).not.toMatch(/select|insert|update|delete from/i);
    expect(result.message).not.toContain('composite_tax_mappings_tax_component_id_foreign');
    // Still logged server-side for diagnostics.
    expect(errorSpy).toHaveBeenCalled();
  });

  it('T035: a select-statement error message is not echoed back', async () => {
    deleteEntityWithValidation.mockRejectedValue(
      new Error('select * from "tax_rates" where "tenant" = \'tenant-1\' - column does not exist')
    );

    const deleteTaxRate = await loadDeleteTaxRate();
    const result: any = await deleteTaxRate('rate-a');

    expect(result.message).toBe('Failed to delete tax rate. Please refresh and try again.');
    expect(result.message).not.toContain('select * from');
  });

  it('T036: the in-transaction not-found guard stays user-visible', async () => {
    deleteEntityWithValidation.mockRejectedValue(new Error('Tax rate not found or already deleted.'));

    const deleteTaxRate = await loadDeleteTaxRate();
    const result: any = await deleteTaxRate('rate-a');

    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.message).toBe('Tax rate not found or already deleted.');
  });

  it('T037: permission-flavoured errors surface as PERMISSION_DENIED', async () => {
    deleteEntityWithValidation.mockRejectedValue(new Error('Permission denied: Cannot delete tax rates'));

    const deleteTaxRate = await loadDeleteTaxRate();
    const result: any = await deleteTaxRate('rate-a');

    expect(result.code).toBe('PERMISSION_DENIED');
    expect(result.message).toBe('Permission denied: Cannot delete tax rates');
    expect(result.dependencies).toEqual([]);
    expect(result.alternatives).toEqual([]);
  });
});
