import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
  };

  function query(table: string) {
    return {
      insert(row: Record<string, unknown>) {
        if (table !== 'teams_conversation_references') {
          throw new Error(`Unexpected table: ${table}`);
        }
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
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: hoisted.warnMock,
  },
}));

import {
  normalizeTeamsConversationType,
  upsertTeamsConversationReference,
} from '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsConversationReferences';

describe('Teams conversation references', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.warnMock.mockClear();
    hoisted.createTenantKnexMock.mockClear();
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
});
