import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
  };

  function makeBuilder(tenant: string) {
    let rows = state.rows.filter((row) => row.tenant === tenant);

    const builder: any = {
      where: (criteria: Record<string, unknown>) => {
        rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
        return builder;
      },
      orderBy: () => builder,
      first: (columns?: string[]) => {
        const row = rows[0];
        if (!row) return Promise.resolve(undefined);
        if (!columns) return Promise.resolve(row);
        return Promise.resolve(Object.fromEntries(columns.map((column) => [column, row[column]])));
      },
      update: (patch: Record<string, unknown>) => {
        for (const row of rows) {
          Object.assign(row, patch);
        }
        return Promise.resolve(rows.length);
      },
    };
    return builder;
  }

  return {
    state,
    makeBuilder,
    warnMock: vi.fn(),
    createTenantKnexMock: vi.fn(async (tenant: string) => ({ knex: {}, tenant })),
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: () => hoisted.makeBuilder(tenant),
  }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: hoisted.warnMock,
  },
}));

import {
  getTeamsConversationContext,
  saveTeamsConversationContext,
} from '@alga-psa/ee-microsoft-teams/lib/teams/bot/teamsConversationReferences';

function seedReferenceRow(tenant: string, conversationId: string): Record<string, unknown> {
  const row: Record<string, unknown> = {
    tenant,
    microsoft_user_id: `aad-${tenant}`,
    conversation_id: conversationId,
    conversation_type: 'personal',
    service_url: 'https://smba.trafficmanager.net/amer/',
    last_activity_at: new Date().toISOString(),
    context: null,
    context_expires_at: null,
  };
  hoisted.state.rows.push(row);
  return row;
}

describe('Teams conversation context (last-listed entities, T065)', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.warnMock.mockClear();
  });

  it('persists the ordered entity list with a 30-minute expiry, tenant-scoped', async () => {
    const tenant1Row = seedReferenceRow('tenant-1', 'conversation-1');
    const tenant2Row = seedReferenceRow('tenant-2', 'conversation-1');

    const before = Date.now();
    const saved = await saveTeamsConversationContext({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      items: [
        { entityType: 'ticket', id: 'ticket-1', displayId: 'ALGA-1' },
        { entityType: 'ticket', id: 'ticket-2' },
      ],
    });

    expect(saved).toBe(true);
    const storedContext = JSON.parse(String(tenant1Row.context));
    expect(storedContext.items).toEqual([
      { entityType: 'ticket', id: 'ticket-1', displayId: 'ALGA-1' },
      { entityType: 'ticket', id: 'ticket-2' },
    ]);
    const expiresAt = Date.parse(String(tenant1Row.context_expires_at));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 29 * 60_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 31 * 60_000);

    // Same conversation id in another tenant is untouched (Citus tenant scoping).
    expect(tenant2Row.context).toBeNull();
    expect(tenant2Row.context_expires_at).toBeNull();
  });

  it('reads back unexpired context and isolates conversations and tenants', async () => {
    const row = seedReferenceRow('tenant-1', 'conversation-1');
    row.context = JSON.stringify({
      items: [{ entityType: 'approval', id: 'approval-1' }],
      listedAt: new Date().toISOString(),
    });
    row.context_expires_at = new Date(Date.now() + 10 * 60_000).toISOString();

    await expect(
      getTeamsConversationContext({ tenantId: 'tenant-1', conversationId: 'conversation-1' })
    ).resolves.toMatchObject({
      items: [{ entityType: 'approval', id: 'approval-1' }],
    });

    await expect(
      getTeamsConversationContext({ tenantId: 'tenant-1', conversationId: 'conversation-other' })
    ).resolves.toBeNull();

    await expect(
      getTeamsConversationContext({ tenantId: 'tenant-2', conversationId: 'conversation-1' })
    ).resolves.toBeNull();
  });

  it('treats expired or missing context as absent (TTL enforced on read)', async () => {
    const row = seedReferenceRow('tenant-1', 'conversation-1');
    row.context = JSON.stringify({
      items: [{ entityType: 'ticket', id: 'ticket-1' }],
      listedAt: new Date().toISOString(),
    });
    row.context_expires_at = new Date(Date.now() - 60_000).toISOString();

    await expect(
      getTeamsConversationContext({ tenantId: 'tenant-1', conversationId: 'conversation-1' })
    ).resolves.toBeNull();

    row.context = null;
    row.context_expires_at = new Date(Date.now() + 60_000).toISOString();
    await expect(
      getTeamsConversationContext({ tenantId: 'tenant-1', conversationId: 'conversation-1' })
    ).resolves.toBeNull();
  });

  it('handles JSONB values that arrive pre-parsed from PostgreSQL', async () => {
    const row = seedReferenceRow('tenant-1', 'conversation-1');
    row.context = {
      items: [{ entityType: 'ticket', id: 'ticket-9', displayId: 'ALGA-9' }],
      listedAt: new Date().toISOString(),
    };
    row.context_expires_at = new Date(Date.now() + 60_000);

    await expect(
      getTeamsConversationContext({ tenantId: 'tenant-1', conversationId: 'conversation-1' })
    ).resolves.toMatchObject({
      items: [{ entityType: 'ticket', id: 'ticket-9', displayId: 'ALGA-9' }],
    });
  });

  it('never persists an empty list', async () => {
    seedReferenceRow('tenant-1', 'conversation-1');
    const saved = await saveTeamsConversationContext({
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      items: [],
    });
    expect(saved).toBe(false);
  });
});
