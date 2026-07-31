import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    accountLinks: [] as Array<{ provider: string; provider_account_id: string | null }>,
  };

  function query(table: string) {
    if (table !== 'teams_conversation_references') {
      throw new Error(`Unexpected table: ${table}`);
    }

    const filters: Record<string, unknown> = {};
    let orderColumn: string | null = null;
    let orderDirection: string | null = null;

    return {
      where(criteria: Record<string, unknown>) {
        Object.assign(filters, criteria);
        return this;
      },
      orderBy(column: string, direction: string) {
        orderColumn = column;
        orderDirection = direction;
        return this;
      },
      first() {
        let candidates = state.rows.filter((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)
        );

        if (orderColumn) {
          candidates = [...candidates].sort((a, b) => {
            const left = Date.parse(String(a[orderColumn!] ?? ''));
            const right = Date.parse(String(b[orderColumn!] ?? ''));
            return orderDirection === 'desc' ? right - left : left - right;
          });
        }

        return Promise.resolve(candidates[0]);
      },
      insert(row: Record<string, unknown>) {
        return {
          onConflict(columns: string[]) {
            if (columns.join(',') !== 'tenant,microsoft_user_id,conversation_id') {
              throw new Error(`Unexpected conflict columns: ${columns.join(',')}`);
            }
            return {
              merge(update: Record<string, unknown>) {
                const existing = state.rows.find(
                  (candidate) =>
                    candidate.tenant === row.tenant &&
                    candidate.microsoft_user_id === row.microsoft_user_id &&
                    candidate.conversation_id === row.conversation_id
                );
                if (existing) {
                  Object.assign(existing, update);
                } else {
                  state.rows.push(row);
                }
              },
            };
          },
        };
      },
    };
  }

  return {
    state,
    warnMock: vi.fn(),
    createTenantKnexMock: vi.fn(async (tenant: string) => ({ knex: query, tenant })),
    listOAuthAccountLinksForUserMock: vi.fn(async () => state.accountLinks),
  };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (tableExpr: string) => {
      const builder = conn(tableExpr);
      if (!builder || typeof builder.where !== 'function') {
        return builder;
      }
      const aliasMatch = /\bas\s+([A-Za-z0-9_]+)\s*$/i.exec(tableExpr.trim());
      const tenantColumn = aliasMatch ? `${aliasMatch[1]}.tenant` : 'tenant';
      builder.where({ [tenantColumn]: tenant });
      return {
        ...builder,
        where: (criteria: any, ...rest: any[]) =>
          criteria && typeof criteria === 'object' && !Array.isArray(criteria)
            ? builder.where({ [tenantColumn]: tenant, ...criteria })
            : builder.where(criteria, ...rest),
      };
    },
    scoped: (t: string) => conn(t),
    subquery: (t: string) => conn(t),
    parentScopedTable: (t: string) => conn(t),
    unscoped: (t: string) => conn(t),
    tenantJoin: (q: any, t: string, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(t) ?? q) : (q.join?.(t) ?? q),
    tenantJoinSubquery: (q: any, sub: any, _l?: any, _r?: any, o: any = {}) =>
      o?.type === 'left' ? (q.leftJoin?.(sub) ?? q) : (q.join?.(sub) ?? q),
    tenantWhereColumn: (q: any) => q,
  }),
  createTenantKnex: hoisted.createTenantKnexMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: hoisted.warnMock,
  },
}));

vi.mock('@alga-psa/auth', () => ({
  getSSORegistry: () => ({
    listOAuthAccountLinksForUser: hoisted.listOAuthAccountLinksForUserMock,
  }),
}));

import {
  getLatestTeamsConversationReferenceImpl,
  normalizeTeamsConversationType,
  upsertTeamsConversationReference,
} from '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsConversationReferences';
import { resolveTeamsRecipientLink } from '@alga-psa/ee-microsoft-teams/lib/notifications/teamsNotificationDelivery';

describe('Teams conversation references', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.state.accountLinks.length = 0;
    hoisted.warnMock.mockClear();
    hoisted.createTenantKnexMock.mockClear();
    hoisted.listOAuthAccountLinksForUserMock.mockClear();
  });

  it('normalizes Bot Framework conversation types to the persisted enum', () => {
    expect(normalizeTeamsConversationType('personal')).toBe('personal');
    expect(normalizeTeamsConversationType('groupChat')).toBe('groupChat');
    expect(normalizeTeamsConversationType('channel')).toBe('channel');
    expect(normalizeTeamsConversationType('unknown')).toBe('personal');
  });

  it('inserts the first inbound conversation reference and updates subsequent activity', async () => {
    const first = await upsertTeamsConversationReference({
      tenantId: 'tenant-1',
      activityAt: '2026-05-24T10:00:00.000Z',
      activity: {
        serviceUrl: 'https://smba.trafficmanager.net/amer/',
        channelId: 'msteams',
        from: {
          aadObjectId: 'aad-user-1',
          id: 'teams-user-1',
        },
        conversation: {
          id: 'conversation-1',
          conversationType: 'personal',
        },
        channelData: {
          tenant: {
            id: 'aad-tenant-1',
          },
        },
      },
    });

    const second = await upsertTeamsConversationReference({
      tenantId: 'tenant-1',
      activityAt: '2026-05-24T10:05:00.000Z',
      activity: {
        serviceUrl: 'https://smba.trafficmanager.net/emea/',
        channelId: 'msteams',
        from: {
          aadObjectId: 'aad-user-1',
        },
        conversation: {
          id: 'conversation-1',
          conversationType: 'groupChat',
        },
        channelData: {
          tenant: {
            id: 'aad-tenant-1',
          },
        },
      },
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(hoisted.state.rows).toHaveLength(1);
    expect(hoisted.state.rows[0]).toMatchObject({
      tenant: 'tenant-1',
      microsoft_user_id: 'aad-user-1',
      conversation_id: 'conversation-1',
      conversation_type: 'groupChat',
      service_url: 'https://smba.trafficmanager.net/emea/',
      tenant_id_aad: 'aad-tenant-1',
      channel_id_bot_framework: 'msteams',
      last_activity_at: '2026-05-24T10:05:00.000Z',
      updated_at: '2026-05-24T10:05:00.000Z',
    });
  });

  it('skips incomplete activities without writing a row', async () => {
    const result = await upsertTeamsConversationReference({
      tenantId: 'tenant-1',
      activity: {
        from: { aadObjectId: 'aad-user-1' },
        conversation: { id: 'conversation-1' },
      },
    });

    expect(result).toBe(false);
    expect(hoisted.state.rows).toHaveLength(0);
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('returns the newest personal conversation reference for the requested tenant and Microsoft user', async () => {
    hoisted.state.rows.push(
      {
        tenant: 'tenant-1',
        microsoft_user_id: 'aad-user-1',
        conversation_id: 'conversation-old',
        conversation_type: 'personal',
        service_url: 'https://smba.trafficmanager.net/amer/',
        tenant_id_aad: 'aad-tenant-1',
        channel_id_bot_framework: 'msteams',
        last_activity_at: '2026-05-24T10:00:00.000Z',
        created_at: '2026-05-24T09:59:00.000Z',
        updated_at: '2026-05-24T10:00:00.000Z',
      },
      {
        tenant: 'tenant-1',
        microsoft_user_id: 'aad-user-1',
        conversation_id: 'conversation-new',
        conversation_type: 'personal',
        service_url: 'https://smba.trafficmanager.net/emea/',
        tenant_id_aad: 'aad-tenant-1',
        channel_id_bot_framework: 'msteams',
        last_activity_at: '2026-05-24T10:05:00.000Z',
        created_at: '2026-05-24T10:04:00.000Z',
        updated_at: '2026-05-24T10:05:00.000Z',
      }
    );

    await expect(
      getLatestTeamsConversationReferenceImpl({
        tenant: 'tenant-1',
        microsoftUserId: 'aad-user-1',
      })
    ).resolves.toMatchObject({
      tenant: 'tenant-1',
      microsoftUserId: 'aad-user-1',
      conversationId: 'conversation-new',
      conversationType: 'personal',
      serviceUrl: 'https://smba.trafficmanager.net/emea/',
      tenantIdAad: 'aad-tenant-1',
      channelIdBotFramework: 'msteams',
      lastActivityAt: '2026-05-24T10:05:00.000Z',
    });
  });

  it('defaults to personal references and supports an explicit conversation type filter', async () => {
    hoisted.state.rows.push(
      {
        tenant: 'tenant-1',
        microsoft_user_id: 'aad-user-1',
        conversation_id: 'group-conversation',
        conversation_type: 'groupChat',
        service_url: 'https://smba.trafficmanager.net/group/',
        last_activity_at: '2026-05-24T11:00:00.000Z',
      },
      {
        tenant: 'tenant-1',
        microsoft_user_id: 'aad-user-1',
        conversation_id: 'personal-conversation',
        conversation_type: 'personal',
        service_url: 'https://smba.trafficmanager.net/personal/',
        last_activity_at: '2026-05-24T10:00:00.000Z',
      }
    );

    await expect(
      getLatestTeamsConversationReferenceImpl({
        tenant: 'tenant-1',
        microsoftUserId: 'aad-user-1',
      })
    ).resolves.toMatchObject({ conversationId: 'personal-conversation' });

    await expect(
      getLatestTeamsConversationReferenceImpl({
        tenant: 'tenant-1',
        microsoftUserId: 'aad-user-1',
        conversationType: 'groupChat',
      })
    ).resolves.toMatchObject({ conversationId: 'group-conversation' });
  });

  it('does not return a reference from another tenant', async () => {
    hoisted.state.rows.push({
      tenant: 'tenant-2',
      microsoft_user_id: 'aad-user-1',
      conversation_id: 'wrong-tenant-conversation',
      conversation_type: 'personal',
      service_url: 'https://smba.trafficmanager.net/amer/',
      last_activity_at: '2026-05-24T10:00:00.000Z',
    });

    await expect(
      getLatestTeamsConversationReferenceImpl({
        tenant: 'tenant-1',
        microsoftUserId: 'aad-user-1',
      })
    ).resolves.toBeNull();
  });

  it('returns null when no matching row exists', async () => {
    await expect(
      getLatestTeamsConversationReferenceImpl({
        tenant: 'tenant-1',
        microsoftUserId: 'aad-user-1',
      })
    ).resolves.toBeNull();
  });

  it('reuses the Microsoft OAuth account provider id as the Teams Microsoft user id', async () => {
    hoisted.state.accountLinks.push(
      { provider: 'google', provider_account_id: 'google-user-1' },
      { provider: 'microsoft', provider_account_id: 'aad-user-1' }
    );

    await expect(resolveTeamsRecipientLink('tenant-1', 'psa-user-1')).resolves.toEqual({
      providerAccountId: 'aad-user-1',
    });
    expect(hoisted.listOAuthAccountLinksForUserMock).toHaveBeenCalledWith('tenant-1', 'psa-user-1');
  });

  it('returns null when the PSA user has no Microsoft account link', async () => {
    hoisted.state.accountLinks.push({ provider: 'google', provider_account_id: 'google-user-1' });

    await expect(resolveTeamsRecipientLink('tenant-1', 'psa-user-1')).resolves.toBeNull();
  });
});
