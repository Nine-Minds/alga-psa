import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const findContactMatchesByEmailMock = vi.fn();
const queueAmbiguousContactMatchMock = vi.fn();
const linkExistingMatchedContactMock = vi.fn();
const createContactForEntraUserMock = vi.fn();

vi.mock('@ee/lib/integrations/entra/sync/contactMatcher', () => ({
  findContactMatchesByEmail: findContactMatchesByEmailMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/contactReconciler', () => ({
  queueAmbiguousContactMatch: queueAmbiguousContactMatchMock,
  linkExistingMatchedContact: linkExistingMatchedContactMock,
  createContactForEntraUser: createContactForEntraUserMock,
}));

function buildUser(seed: string): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant-111',
    entraObjectId: `entra-object-${seed}`,
    userPrincipalName: `${seed}@example.com`,
    email: `${seed}@example.com`,
    displayName: `User ${seed}`,
    givenName: 'User',
    surname: seed,
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
  };
}

describe('executeEntraSync dry-run behavior', () => {
  it('T111: returns preview counters without running any write paths', async () => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();

    findContactMatchesByEmailMock
      .mockResolvedValueOnce([
        {
          contactNameId: 'contact-amb-1',
          clientId: 'client-111',
          email: 'ambiguous@example.com',
          fullName: 'Ambiguous One',
          isInactive: false,
        },
        {
          contactNameId: 'contact-amb-2',
          clientId: 'client-111',
          email: 'ambiguous@example.com',
          fullName: 'Ambiguous Two',
          isInactive: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          contactNameId: 'contact-linked',
          clientId: 'client-111',
          email: 'linked@example.com',
          fullName: 'Linked User',
          isInactive: false,
        },
      ])
      .mockResolvedValueOnce([]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-111',
      clientId: 'client-111',
      managedTenantId: 'managed-111',
      dryRun: true,
      users: [buildUser('ambiguous'), buildUser('linked'), buildUser('created')],
    });

    expect(result).toEqual({
      dryRun: true,
      counters: {
        created: 1,
        linked: 1,
        updated: 0,
        ambiguous: 1,
        inactivated: 0,
      },
    });
    expect(findContactMatchesByEmailMock).toHaveBeenCalledTimes(3);
    expect(queueAmbiguousContactMatchMock).not.toHaveBeenCalled();
    expect(linkExistingMatchedContactMock).not.toHaveBeenCalled();
    expect(createContactForEntraUserMock).not.toHaveBeenCalled();
  });
});

describe('executeEntraSync updated counter', () => {
  beforeEach(() => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();
  });

  const matchFor = (seed: string) => [
    {
      contactNameId: `contact-${seed}`,
      clientId: 'client-222',
      email: `${seed}@example.com`,
      fullName: `User ${seed}`,
      isInactive: false,
    },
  ];

  it('counts a link that overwrote a field as updated', async () => {
    findContactMatchesByEmailMock.mockResolvedValue(matchFor('overwritten'));
    linkExistingMatchedContactMock.mockResolvedValue({
      action: 'linked',
      fieldsUpdated: true,
      contactNameId: 'contact-overwritten',
      linkIdentity: { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-overwritten' },
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-222',
      clientId: 'client-222',
      managedTenantId: 'managed-222',
      fieldSyncConfig: { displayName: true },
      users: [buildUser('overwritten')],
    });

    expect(result.counters).toEqual({
      created: 0,
      linked: 1,
      updated: 1,
      ambiguous: 0,
      inactivated: 0,
    });
  });

  it('leaves updated at zero when a link changed nothing', async () => {
    findContactMatchesByEmailMock.mockResolvedValue(matchFor('unchanged'));
    linkExistingMatchedContactMock.mockResolvedValue({
      action: 'linked',
      fieldsUpdated: false,
      contactNameId: 'contact-unchanged',
      linkIdentity: { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-unchanged' },
    });

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-222',
      clientId: 'client-222',
      managedTenantId: 'managed-222',
      users: [buildUser('unchanged')],
    });

    expect(result.counters.linked).toBe(1);
    expect(result.counters.updated).toBe(0);
  });
});
