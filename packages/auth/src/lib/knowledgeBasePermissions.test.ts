import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getUserRolesWithPermissions: vi.fn()
  }
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn())
}));

import { canReadKnowledgeBase, canReadPublishedKnowledgeBase } from './knowledgeBasePermissions';
import type { IUser } from '@alga-psa/types';

const userOf = (user_type: IUser['user_type']): IUser => ({
  user_id: 'u1',
  username: 'u1',
  email: 'u1@example.com',
  hashed_password: 'hash',
  is_inactive: false,
  tenant: 'tenant-1',
  user_type,
  created_at: new Date()
});

async function grant(resources: string[], portal: 'msp' | 'client') {
  const { default: User } = await import('@alga-psa/db/models/user');
  const msp = portal === 'msp';
  vi.mocked(User.getUserRolesWithPermissions).mockResolvedValue([{
    role_id: 'r1',
    role_name: 'role',
    description: 'role',
    msp,
    client: !msp,
    permissions: resources.map(resource => ({
      permission_id: resource,
      resource,
      action: 'read',
      msp,
      client: !msp
    }))
  }]);
}

describe('knowledge base permissions', () => {
  beforeEach(async () => {
    const { default: User } = await import('@alga-psa/db/models/user');
    vi.mocked(User.getUserRolesWithPermissions).mockReset();
  });

  it('lets the general document grant read the internal and published knowledge base', async () => {
    await grant(['document'], 'client');
    await expect(canReadKnowledgeBase(userOf('client'))).resolves.toBe(true);
    await expect(canReadPublishedKnowledgeBase(userOf('client'))).resolves.toBe(true);
  });

  it('lets an MSP scoped knowledge_base grant read the internal knowledge base', async () => {
    await grant(['knowledge_base'], 'msp');
    await expect(canReadKnowledgeBase(userOf('internal'))).resolves.toBe(true);
  });

  it('limits a client scoped knowledge_base grant to the published portal knowledge base', async () => {
    await grant(['knowledge_base'], 'client');
    await expect(canReadKnowledgeBase(userOf('client'))).resolves.toBe(false);
    await expect(canReadPublishedKnowledgeBase(userOf('client'))).resolves.toBe(true);
  });

  it('denies both without a document or knowledge_base grant', async () => {
    await grant(['ticket'], 'client');
    await expect(canReadKnowledgeBase(userOf('client'))).resolves.toBe(false);
    await expect(canReadPublishedKnowledgeBase(userOf('client'))).resolves.toBe(false);
  });
});
