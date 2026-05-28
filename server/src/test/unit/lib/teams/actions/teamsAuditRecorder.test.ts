import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
  };

  const knex = Object.assign(
    (table: string) => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        if (table !== 'teams_audit_events') {
          throw new Error(`Unexpected table: ${table}`);
        }
        state.rows.push(row);
      }),
    }),
    {}
  );

  return {
    state,
    warnMock: vi.fn(),
    createTenantKnexMock: vi.fn(async (tenant: string) => ({ knex, tenant })),
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
  computeTeamsAuditPayloadHash,
  writeTeamsAuditEvent,
} from '@alga-psa/ee-microsoft-teams/lib/teams/actions/teamsAuditRecorder';

describe('Teams audit recorder', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.warnMock.mockClear();
    hoisted.createTenantKnexMock.mockClear();
  });

  it('canonicalizes payloads before hashing', () => {
    const first = computeTeamsAuditPayloadHash({
      ticketId: 'ticket-1',
      nested: {
        b: 2,
        a: 1,
      },
    });
    const second = computeTeamsAuditPayloadHash({
      nested: {
        a: 1,
        b: 2,
      },
      ticketId: 'ticket-1',
    });

    expect(first).toBe(second);
  });

  it('persists only safe metadata and payload_hash for an audit event', async () => {
    await writeTeamsAuditEvent({
      tenant: 'tenant-1',
      actorUserId: 'user-1',
      microsoftUserId: 'aad-user-1',
      surface: 'bot',
      actionId: 'assign_ticket',
      targetType: 'ticket',
      targetId: 'ticket-1',
      idempotencyKey: 'idem-1',
      payload: {
        note: 'raw note body should be hashed only',
        assigneeId: 'user-2',
      },
      resultStatus: 'success',
    });

    expect(hoisted.state.rows).toHaveLength(1);
    expect(hoisted.state.rows[0]).toMatchObject({
      tenant: 'tenant-1',
      actor_user_id: 'user-1',
      microsoft_user_id: 'aad-user-1',
      surface: 'bot',
      action_id: 'assign_ticket',
      target_type: 'ticket',
      target_id: 'ticket-1',
      idempotency_key: 'idem-1',
      result_status: 'success',
      error_code: null,
    });
    expect(typeof hoisted.state.rows[0].payload_hash).toBe('string');
    expect(JSON.stringify(hoisted.state.rows[0])).not.toContain('raw note body should be hashed only');
  });
});
