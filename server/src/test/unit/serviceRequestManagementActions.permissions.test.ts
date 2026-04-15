import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTenantKnexMock } = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
  };
});

import { getCurrentUser, hasPermission } from '@alga-psa/auth';
import {
  createBlankServiceRequestDefinitionAction,
  listServiceRequestDefinitionsAction,
} from '../../app/msp/service-requests/actions';

describe('service request management action permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    vi.mocked(getCurrentUser).mockResolvedValue({
      user_id: '00000000-0000-0000-0000-000000000123',
      tenant: '00000000-0000-0000-0000-000000000999',
      user_type: 'internal',
      roles: [],
    } as any);
  });

  it('denies create when the caller lacks service create permission', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);

    await expect(createBlankServiceRequestDefinitionAction()).rejects.toThrow(
      'Service permission "create" required'
    );
  });

  it('denies read actions for authenticated client users', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      user_id: '00000000-0000-0000-0000-000000000124',
      tenant: '00000000-0000-0000-0000-000000000999',
      user_type: 'client',
      roles: [],
    } as any);
    vi.mocked(hasPermission).mockResolvedValue(true);

    await expect(listServiceRequestDefinitionsAction()).rejects.toThrow('MSP user required');
  });
});
