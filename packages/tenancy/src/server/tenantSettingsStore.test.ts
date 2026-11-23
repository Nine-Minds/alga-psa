import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  row: {
    onboarding_data: { clientEmail: 'private@example.test' },
    settings: {
      branding: { clientName: 'Example', credential: 'private' },
      defaultLocale: 'en',
      clientPortal: { defaultLocale: 'fr', arbitrary: 'private' },
      theme: { color: 'blue' },
      sso: { privateKey: 'private' },
    },
  },
  selected: [] as unknown[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: () => ({
      select: (columns: unknown) => {
        state.selected.push(columns);
        return { first: async () => state.row };
      },
    }),
  }),
}));

import { readTenantPortalSettings } from './tenantSettingsStore';

describe('tenant settings server boundary', () => {
  beforeEach(() => { state.selected = []; });

  it('projects portal settings without returning onboarding or unrelated JSON keys', async () => {
    const projected = await readTenantPortalSettings('tenant-a');
    expect(projected).toEqual({
      branding: { clientName: 'Example', credential: 'private' },
      defaultLocale: 'en',
      clientPortalDefaultLocale: 'fr',
      theme: { color: 'blue' },
    });
    expect(projected).not.toHaveProperty('onboarding_data');
    expect(projected).not.toHaveProperty('sso');
    expect(state.selected).toEqual(['settings']);
  });
});
