import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DattoRmmPermissionError } from '@ee/lib/integrations/datto/dattoApiClient';

let integrationRow: Record<string, any> | null;
let client: { resolveAlert: ReturnType<typeof vi.fn> } | null;
const buildDattoClientForTenant = vi.fn(async () => client);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
}));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => integrationRow),
  buildDattoClientForTenant: (...args: any[]) => (buildDattoClientForTenant as any)(...args),
}));

const args = { tenantId: 'tenant_1', integrationId: 'int_1', externalAlertId: 'alert-1' };

describe('dattoRmmAlertOutboundAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client = { resolveAlert: vi.fn(async () => undefined) };
    integrationRow = { integration_id: 'int_1', settings: { resolveAlertsOnTicketClose: true } };
  });

  it('T060: resolves the Datto alert when resolveAlertsOnTicketClose is enabled', async () => {
    const { dattoRmmAlertOutboundAdapter } = await import('@ee/lib/integrations/datto/alertOutbound');
    await dattoRmmAlertOutboundAdapter.resetAlert(args);
    expect(client!.resolveAlert).toHaveBeenCalledWith('alert-1');
  });

  it('accepts settings stored as a JSON string', async () => {
    integrationRow = { settings: JSON.stringify({ resolveAlertsOnTicketClose: true }) };
    const { dattoRmmAlertOutboundAdapter } = await import('@ee/lib/integrations/datto/alertOutbound');
    await dattoRmmAlertOutboundAdapter.resetAlert(args);
    expect(client!.resolveAlert).toHaveBeenCalledTimes(1);
  });

  it.each([[{}], [{ resolveAlertsOnTicketClose: false }], [null]])(
    'makes no remote call when the toggle is not true (%j)',
    async (settings) => {
      integrationRow = { settings };
      const { dattoRmmAlertOutboundAdapter } = await import('@ee/lib/integrations/datto/alertOutbound');
      await expect(dattoRmmAlertOutboundAdapter.resetAlert(args)).resolves.toBeUndefined();
      expect(buildDattoClientForTenant).not.toHaveBeenCalled();
      expect(client!.resolveAlert).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{ resolveAlertsOnTicketClose: true }, true],
    [{ resolveAlertsOnTicketClose: false }, false],
    [{}, false],
  ])('isResetEnabled reflects the toggle (%j → %s)', async (settings, expected) => {
    integrationRow = { settings };
    const { dattoRmmAlertOutboundAdapter } = await import('@ee/lib/integrations/datto/alertOutbound');
    await expect(
      dattoRmmAlertOutboundAdapter.isResetEnabled!({ tenantId: 'tenant_1', integrationId: 'int_1' })
    ).resolves.toBe(expected);
  });

  it('isResetEnabled answers false when there is no integration row', async () => {
    integrationRow = null;
    const { dattoRmmAlertOutboundAdapter } = await import('@ee/lib/integrations/datto/alertOutbound');
    await expect(
      dattoRmmAlertOutboundAdapter.isResetEnabled!({ tenantId: 'tenant_1', integrationId: 'int_1' })
    ).resolves.toBe(false);
  });

  it('does nothing when there is no Datto integration row', async () => {
    integrationRow = null;
    const { dattoRmmAlertOutboundAdapter } = await import('@ee/lib/integrations/datto/alertOutbound');
    await expect(dattoRmmAlertOutboundAdapter.resetAlert(args)).resolves.toBeUndefined();
    expect(buildDattoClientForTenant).not.toHaveBeenCalled();
  });

  it('turns a permission error into a message about API user write rights', async () => {
    client!.resolveAlert.mockRejectedValue(new DattoRmmPermissionError('forbidden', { status: 403, path: '/x' }));
    const { dattoRmmAlertOutboundAdapter } = await import('@ee/lib/integrations/datto/alertOutbound');
    await expect(dattoRmmAlertOutboundAdapter.resetAlert(args)).rejects.toThrow(/API user needs write rights/i);
  });

  it('propagates other errors and reports a missing client', async () => {
    client!.resolveAlert.mockRejectedValue(new Error('boom'));
    const { dattoRmmAlertOutboundAdapter } = await import('@ee/lib/integrations/datto/alertOutbound');
    await expect(dattoRmmAlertOutboundAdapter.resetAlert(args)).rejects.toThrow('boom');

    client = null;
    await expect(dattoRmmAlertOutboundAdapter.resetAlert(args)).rejects.toThrow(/not configured/i);
  });
});
