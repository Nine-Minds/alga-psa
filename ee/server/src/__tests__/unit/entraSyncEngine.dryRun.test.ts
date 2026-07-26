import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const findContactMatchesByEmailMock = vi.fn();
const queueAmbiguousContactMatchMock = vi.fn();
const linkExistingMatchedContactMock = vi.fn();
const createContactForEntraUserMock = vi.fn();
const previewLinkedContactChangeMock = vi.fn();
const markDisabledEntraUsersInactiveMock = vi.fn();
const selectLinkedEntraIdentitiesMock = vi.fn();

vi.mock('@ee/lib/integrations/entra/sync/contactMatcher', () => ({
  findContactMatchesByEmail: findContactMatchesByEmailMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/contactReconciler', () => ({
  queueAmbiguousContactMatch: queueAmbiguousContactMatchMock,
  linkExistingMatchedContact: linkExistingMatchedContactMock,
  createContactForEntraUser: createContactForEntraUserMock,
  previewLinkedContactChange: previewLinkedContactChangeMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/disableHandler', () => ({
  markDisabledEntraUsersInactive: markDisabledEntraUsersInactiveMock,
  selectLinkedEntraIdentities: selectLinkedEntraIdentitiesMock,
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
    previewLinkedContactChangeMock.mockReset();
    previewLinkedContactChangeMock.mockResolvedValue({ alreadyLinked: false, fieldsWouldChange: false });

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

    expect(result.dryRun).toBe(true);
    expect(result.counters).toEqual({
      created: 1,
      linked: 1,
      updated: 0,
      ambiguous: 1,
      inactivated: 0,
    });
    expect(result.preview?.map((identity) => identity.bucket)).toEqual([
      'needs_decision',
      'link',
      'create',
    ]);
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
    previewLinkedContactChangeMock.mockReset();
    markDisabledEntraUsersInactiveMock.mockReset();
    selectLinkedEntraIdentitiesMock.mockReset();
    selectLinkedEntraIdentitiesMock.mockResolvedValue([]);
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

describe('executeEntraSync inactivation is inside the dry-run guard', () => {
  const disabled = [
    {
      entraTenantId: 'entra-tenant-111',
      entraObjectId: 'entra-object-disabled',
      displayName: 'Disabled User',
      email: 'disabled@example.com',
      userPrincipalName: 'disabled@example.com',
    },
  ];

  beforeEach(() => {
    findContactMatchesByEmailMock.mockReset();
    queueAmbiguousContactMatchMock.mockReset();
    linkExistingMatchedContactMock.mockReset();
    createContactForEntraUserMock.mockReset();
    previewLinkedContactChangeMock.mockReset();
    markDisabledEntraUsersInactiveMock.mockReset();
    selectLinkedEntraIdentitiesMock.mockReset();
    selectLinkedEntraIdentitiesMock.mockResolvedValue([]);
  });

  it('F8: a dry run counts the inactivations it would make and performs none', async () => {
    selectLinkedEntraIdentitiesMock.mockResolvedValue([
      { identity: disabled[0], linkedContactCount: 1 },
    ]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-333',
      clientId: 'client-333',
      managedTenantId: 'managed-333',
      dryRun: true,
      users: [],
      disabledIdentities: disabled,
    });

    // The landmine: a preview that deactivates real contacts is worse than no
    // preview at all.
    expect(markDisabledEntraUsersInactiveMock).not.toHaveBeenCalled();
    expect(result.counters.inactivated).toBe(1);
    expect(result.preview).toEqual([
      expect.objectContaining({ bucket: 'mark_inactive', entraObjectId: 'entra-object-disabled' }),
    ]);
  });

  it('does not promise to inactivate a disabled account that has no contact here', async () => {
    // The account is disabled in Entra but was never synced into Alga, so there
    // is nothing to mark. Listing it under "Marked inactive" would tell the
    // operator a change is coming that the real run cannot make.
    selectLinkedEntraIdentitiesMock.mockResolvedValue([]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-333',
      clientId: 'client-333',
      managedTenantId: 'managed-333',
      dryRun: true,
      users: [],
      disabledIdentities: disabled,
    });

    expect(result.counters.inactivated).toBe(0);
    expect(result.preview).toEqual([]);
  });

  it('a real run performs the inactivation and reports the same count', async () => {
    markDisabledEntraUsersInactiveMock.mockResolvedValue(1);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const result = await executeEntraSync({
      tenantId: 'tenant-333',
      clientId: 'client-333',
      managedTenantId: 'managed-333',
      users: [],
      disabledIdentities: disabled,
    });

    expect(markDisabledEntraUsersInactiveMock).toHaveBeenCalledWith('tenant-333', [
      { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-disabled' },
    ]);
    expect(selectLinkedEntraIdentitiesMock).not.toHaveBeenCalled();
    expect(result.counters.inactivated).toBe(1);
    expect(result.preview).toBeUndefined();
  });

  it('a preflight reports the counts the real run then reports on unchanged data', async () => {
    const users = [buildUser('created'), buildUser('linked')];
    const linkedMatch = [
      {
        contactNameId: 'contact-linked',
        clientId: 'client-444',
        email: 'linked@example.com',
        fullName: 'Linked User',
        isInactive: false,
      },
    ];

    findContactMatchesByEmailMock.mockImplementation(async (_tenant, _client, user) =>
      user.entraObjectId === 'entra-object-linked' ? linkedMatch : []
    );
    previewLinkedContactChangeMock.mockResolvedValue({ alreadyLinked: false, fieldsWouldChange: true });
    selectLinkedEntraIdentitiesMock.mockResolvedValue([
      { identity: disabled[0], linkedContactCount: 1 },
    ]);

    const { executeEntraSync } = await import('@ee/lib/integrations/entra/sync/syncEngine');
    const preview = await executeEntraSync({
      tenantId: 'tenant-444',
      clientId: 'client-444',
      managedTenantId: 'managed-444',
      dryRun: true,
      users,
      disabledIdentities: disabled,
    });

    linkExistingMatchedContactMock.mockResolvedValue({
      action: 'linked',
      fieldsUpdated: true,
      contactNameId: 'contact-linked',
      linkIdentity: { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-linked' },
    });
    createContactForEntraUserMock.mockResolvedValue({
      action: 'created',
      contactNameId: 'contact-created',
      linkIdentity: { entraTenantId: 'entra-tenant-111', entraObjectId: 'entra-object-created' },
    });
    markDisabledEntraUsersInactiveMock.mockResolvedValue(1);

    const real = await executeEntraSync({
      tenantId: 'tenant-444',
      clientId: 'client-444',
      managedTenantId: 'managed-444',
      users,
      disabledIdentities: disabled,
    });

    expect(preview.counters).toEqual(real.counters);
  });
});
