import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {
    branding: {
      logoUrl: 'https://cdn.example.test/logo.svg',
      primaryColor: '#123456',
      secondaryColor: '#654321',
      clientName: 'Example',
      logoMarkSource: { kind: 'square', documentId: 'private-document' },
      nested: { credential: 'private' },
      unexpected: ['private'],
    },
    supportEmail: 'help@example.test',
    supportPhone: '+15551234567',
  },
}));

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@alga-psa/db', () => ({
  getConnection: async () => ({}),
  tenantDb: () => ({ table: () => ({ first: async () => ({ settings: state.settings }) }) }),
}));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));
vi.mock('@alga-psa/auth', () => ({
  withOptionalAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-a' }, { tenant: 'tenant-a' }, ...args),
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-a' }, { tenant: 'tenant-a' }, ...args),
}));

import { getTenantBrandingAction, getTenantBrandingByIdAction } from './tenantBrandingActions';

describe('tenant branding response projection', () => {
  beforeEach(() => {
    state.settings.branding = {
      logoUrl: 'https://cdn.example.test/logo.svg',
      primaryColor: '#123456',
      secondaryColor: '#654321',
      clientName: 'Example',
      logoMarkSource: { kind: 'square', documentId: 'private-document' },
      nested: { credential: 'private' },
      unexpected: ['private'],
    };
  });

  it('projects authenticated and public branding responses using the same allow-list', async () => {
    for (const read of [getTenantBrandingAction(), getTenantBrandingByIdAction('tenant-a')]) {
      await expect(read).resolves.toMatchObject({
        logoUrl: 'https://cdn.example.test/logo.svg',
        primaryColor: '#123456',
        clientName: 'Example',
        supportEmail: 'help@example.test',
        supportPhone: '+15551234567',
      });
      const response = await read;
      expect(response).not.toHaveProperty('logoMarkSource');
      expect(response).not.toHaveProperty('nested');
      expect(response).not.toHaveProperty('unexpected');
    }
  });
});
