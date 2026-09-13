import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ installation: null as null | { appliance_credential: string | null }, tenantExists: true,
  scope: vi.fn(), admin: vi.fn(), locks: [] as string[] }));
vi.mock('../../../../../../packages/licensing/src/lib/tenant-license-state', () => ({ getTenantLicenseManagementScope: state.scope }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: state.admin }));
vi.mock('@alga-psa/db', () => ({
  withTransaction: async (db: unknown, work: (trx: unknown) => unknown) => work(db),
  tenantDb: (_db: unknown, tenant: string) => ({ table: (table: string) => ({
    forShare() { state.locks.push(`${table}:${tenant}`); return this; },
    async first() { return state.tenantExists ? { tenant } : undefined; },
  }) }),
}));
import { getSelfHostAiGatewayCredential } from '../../../../../../packages/licensing/src/lib/ai-gateway-auth';
const db = Object.assign((table: string) => ({ orderBy() { return this; },
  forShare() { state.locks.push(table); return this; }, async first() { return state.installation; } }), { isTransaction: true });
beforeEach(() => { vi.clearAllMocks(); state.locks = []; state.installation = null; state.tenantExists = true;
  state.scope.mockResolvedValue('installation'); state.admin.mockResolvedValue(db); });
it('returns hosted mode only when the authoritative installation row is absent', async () => {
  expect(await getSelfHostAiGatewayCredential('tenant')).toBeNull(); expect(state.scope).not.toHaveBeenCalled();
});
it('retains installation and tenant identity before returning an ordinary appliance credential', async () => {
  state.installation = { appliance_credential: ' fixture-appliance-secret ' };
  expect(await getSelfHostAiGatewayCredential('tenant')).toBe('fixture-appliance-secret');
  expect(state.locks).toEqual(['license_state', 'tenants:tenant']); expect(state.scope).toHaveBeenCalledWith(db, 'tenant');
});
it('refuses the appliance account for customer-owned licensing scope', async () => {
  state.installation = { appliance_credential: 'fixture-appliance-secret' }; state.scope.mockResolvedValue('tenant');
  await expect(getSelfHostAiGatewayCredential('customer')).rejects.toThrow('own AI gateway connection');
});
it('does not interpret scope or connection database failures as hosted mode', async () => {
  state.installation = { appliance_credential: 'fixture-appliance-secret' }; state.scope.mockRejectedValue(new Error('scope unavailable'));
  await expect(getSelfHostAiGatewayCredential('tenant')).rejects.toThrow('scope unavailable');
  state.admin.mockRejectedValue(new Error('database unavailable'));
  await expect(getSelfHostAiGatewayCredential('tenant')).rejects.toThrow('database unavailable');
});
it('rejects nonexistent tenants and missing appliance credentials', async () => {
  state.installation = { appliance_credential: 'fixture-appliance-secret' }; state.tenantExists = false;
  await expect(getSelfHostAiGatewayCredential('tenant')).rejects.toThrow('workspace is not available');
  state.tenantExists = true; state.installation.appliance_credential = ' ';
  await expect(getSelfHostAiGatewayCredential('tenant')).rejects.toThrow('requires an appliance credential');
});
it('rejects empty actor identity before database access', async () => {
  await expect(getSelfHostAiGatewayCredential(' ')).rejects.toThrow('tenant identity'); expect(state.admin).not.toHaveBeenCalled();
});
