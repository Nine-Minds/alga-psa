/* eslint-disable custom-rules/no-feature-to-feature-imports -- tests both the billing selector and the integrations connection helpers */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const selected = vi.hoisted(() => ({ realm: 'org-2' as string | null }));
const connectionsState = vi.hoisted(() => ({
  value: {
    'conn-1': { connectionId: 'conn-1', xeroTenantId: 'org-1' },
    'conn-2': { connectionId: 'conn-2', xeroTenantId: 'org-2' }
  } as Record<string, { connectionId: string; xeroTenantId: string }>
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (_tenant: string, name: string) =>
      name === 'xero_credentials' ? JSON.stringify(connectionsState.value) : null
  })
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: () => ({
      select: () => ({
        first: async () => ({
          settings: { accountingSync: { defaultRealm: selected.realm } }
        })
      })
    })
  })
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: async () => ({ 'qbo-realm': {} }),
  getDefaultQboRealmId: async () => 'qbo-realm'
}));

import { resolveConnectedAccountingIntegration } from './connectedAccountingIntegration';
import { resolveDefaultXeroConnectionId } from '@alga-psa/integrations/lib/xero/xeroClientService';

beforeEach(() => {
  selected.realm = 'org-2';
  connectionsState.value = {
    'conn-1': { connectionId: 'conn-1', xeroTenantId: 'org-1' },
    'conn-2': { connectionId: 'conn-2', xeroTenantId: 'org-2' }
  };
});

describe('persisted Xero selection normalization (settings vs sync routing)', () => {
  it('routes settings and provider-scoped sync to the same connection for a historical organisation default', async () => {
    const settingsTarget = await resolveDefaultXeroConnectionId('tenant-1');
    expect(settingsTarget).toBe('conn-2');

    const syncTarget = await resolveConnectedAccountingIntegration({} as any, 'tenant-1', {
      preferredAdapterType: 'xero'
    });
    expect(syncTarget).toEqual({ adapterType: 'xero', targetRealm: settingsTarget });
  });

  it('honours the Xero default over a connected QBO realm in generic routing', async () => {
    const syncTarget = await resolveConnectedAccountingIntegration({} as any, 'tenant-1', {});

    // Before normalization the unresolved organisation id fell through to the
    // QBO default; the persisted Xero selection must win.
    expect(syncTarget).toEqual({ adapterType: 'xero', targetRealm: 'conn-2' });
  });

  it('fails closed for ambiguous organisation ownership in both selectors', async () => {
    connectionsState.value = {
      'conn-1': { connectionId: 'conn-1', xeroTenantId: 'org-shared' },
      'conn-2': { connectionId: 'conn-2', xeroTenantId: 'org-shared' }
    };
    selected.realm = 'org-shared';

    const settingsTarget = await resolveDefaultXeroConnectionId('tenant-1');
    // Ambiguous ownership is not guessed: settings reports unavailable.
    expect(settingsTarget).toBeNull();

    const syncTarget = await resolveConnectedAccountingIntegration({} as any, 'tenant-1', {
      preferredAdapterType: 'xero'
    });
    expect(syncTarget).toBeNull();
  });

  it('does not route an ambiguous persisted organisation to an unrelated first connection', async () => {
    connectionsState.value = {
      'conn-unrelated': { connectionId: 'conn-unrelated', xeroTenantId: 'org-unrelated' },
      'conn-1': { connectionId: 'conn-1', xeroTenantId: 'org-shared' },
      'conn-2': { connectionId: 'conn-2', xeroTenantId: 'org-shared' }
    };
    selected.realm = 'org-shared';

    await expect(resolveDefaultXeroConnectionId('tenant-1')).resolves.toBeNull();
    await expect(
      resolveConnectedAccountingIntegration({} as any, 'tenant-1', { preferredAdapterType: 'xero' })
    ).resolves.toBeNull();
    // Generic routing (no preferred provider) must not fall through to QBO or
    // the first Xero connection either.
    await expect(
      resolveConnectedAccountingIntegration({} as any, 'tenant-1', {})
    ).resolves.toBeNull();
  });

  it('keeps an explicit unavailable target failing closed without normalization', async () => {
    const syncTarget = await resolveConnectedAccountingIntegration({} as any, 'tenant-1', {
      preferredAdapterType: 'xero',
      preferredTargetRealm: 'org-2'
    });

    // An explicit ORGANISATION that is not a connection key is unavailable —
    // normalization applies only to the persisted default, never to an
    // explicit request.
    expect(syncTarget).toBeNull();
  });
});
