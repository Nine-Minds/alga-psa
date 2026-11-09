import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Array<Record<string, unknown>> = [];
const tableCalls: string[] = [];
const coManaged = vi.fn(async () => false);

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_trx: unknown, _tenant: string) => ({
    table: (name: string) => {
      tableCalls.push(name);
      return { insert: async (row: Record<string, unknown>) => { inserts.push(row); } };
    },
  }),
}));
vi.mock('@alga-psa/db/writeAdmission', () => ({
  isCoManagedWorkspace: (...args: unknown[]) => (coManaged as any)(...args),
}));

import {
  commentThreadPayloadLabel,
  insertCommentThread,
  registerCommentThreadInsertContributor,
  resetCommentThreadInsertContributors,
} from '../commentThreadInsert';
import { CoManagedAudienceRequiredError } from '../commentAudience';

const AT = '2026-11-09T10:00:00.000Z';
const base = { threadId: 't1', ticketId: 'k1', rootCommentId: 'c1', createdBy: 'u1', at: AT };
const trx = {} as any;

beforeEach(() => {
  inserts.length = 0;
  tableCalls.length = 0;
  coManaged.mockReset();
  coManaged.mockResolvedValue(false);
  resetCommentThreadInsertContributors();
});

describe('insertCommentThread', () => {
  it('writes the same root row as the call sites do today for a native tenant, with one insert and no other work', async () => {
    const applied = await insertCommentThread(trx, 'ten', {
      ...base, isInternal: false,
      audience: { kind: 'native', isInternal: false, authorType: 'internal', requested: null },
    });
    expect(applied).toEqual({});
    expect(tableCalls).toEqual(['comment_threads']);
    expect(inserts).toEqual([{
      tenant: 'ten', thread_id: 't1', ticket_id: 'k1', project_task_id: null, root_comment_id: 'c1',
      is_internal: false, reply_count: 0, last_activity_at: AT, created_at: AT, created_by: 'u1',
    }]);
    expect(Object.keys(inserts[0])).toEqual([
      'tenant', 'thread_id', 'ticket_id', 'project_task_id', 'root_comment_id', 'is_internal',
      'reply_count', 'last_activity_at', 'created_at', 'created_by',
    ]);
  });

  it('gives {} for an internal note or a non-staff author without consulting the workspace cache', async () => {
    for (const [isInternal, authorType] of [[true, 'internal'], [false, 'client'], [false, undefined]] as const) {
      expect(await insertCommentThread(trx, 'ten', {
        ...base, isInternal, audience: { kind: 'native', isInternal, authorType, requested: undefined },
      })).toEqual({});
    }
    expect(coManaged).not.toHaveBeenCalled();
  });

  it('fails closed in a co-managed workspace without an audience, and writes nothing', async () => {
    coManaged.mockResolvedValue(true);
    await expect(insertCommentThread(trx, 'ten', {
      ...base, isInternal: false, audience: { kind: 'native', isInternal: false, authorType: 'internal', requested: null },
    })).rejects.toBeInstanceOf(CoManagedAudienceRequiredError);
    expect(inserts).toHaveLength(0);
  });

  it('labels the row with a named audience in a co-managed workspace', async () => {
    coManaged.mockResolvedValue(true);
    const applied = await insertCommentThread(trx, 'ten', {
      ...base, isInternal: false, audience: { kind: 'native', isInternal: false, authorType: 'internal', requested: 'requester' },
    });
    expect(applied).toEqual({ collaboration_audience: 'requester' });
    expect(inserts[0]).toMatchObject({ is_internal: false, collaboration_audience: 'requester' });
  });

  it('passes a resolved audience through unchanged', async () => {
    const applied = await insertCommentThread(trx, 'ten', {
      ...base, isInternal: true, audience: { kind: 'resolved', audience: { collaboration_audience: 'shared_it' } },
    });
    expect(applied).toEqual({ collaboration_audience: 'shared_it' });
    expect(inserts[0].collaboration_audience).toBe('shared_it');
    expect(coManaged).not.toHaveBeenCalled();
  });

  it('adds no columns when no contributor is registered', async () => {
    await insertCommentThread(trx, 'ten', {
      ...base, isInternal: true, audience: { kind: 'resolved', audience: {} },
    });
    expect(Object.keys(inserts[0])).not.toContain('conversation_id');
  });

  it('merges a registered contributor\'s columns, in order, and hands it the intent', async () => {
    const seen: unknown[] = [];
    registerCommentThreadInsertContributor((_t, tenant, row, intent) => {
      seen.push({ tenant, thread: row.thread_id, intent });
      return { conversation_id: (intent as any)?.conversationId ?? null };
    });
    registerCommentThreadInsertContributor((_t, _tenant, row) => ({ extra: row.conversation_id }));
    await insertCommentThread(trx, 'ten', {
      ...base, isInternal: true, audience: { kind: 'resolved', audience: {} }, intent: { conversationId: 'cv1' } as any,
    });
    expect(seen).toEqual([{ tenant: 'ten', thread: 't1', intent: { conversationId: 'cv1' } }]);
    expect(inserts[0]).toMatchObject({ conversation_id: 'cv1', extra: 'cv1' });
  });
});

describe('commentThreadPayloadLabel', () => {
  it('matches the spread every site used', () => {
    const siteSpread = (a: { collaboration_audience?: string }, threadId: string) =>
      a.collaboration_audience ? { collaboration_audience: a.collaboration_audience, thread_id: threadId } : {};
    for (const applied of [{}, { collaboration_audience: 'requester' as const }, { collaboration_audience: 'shared_it' as const }]) {
      expect(commentThreadPayloadLabel(applied, 't1')).toEqual(siteSpread(applied, 't1'));
    }
    expect(commentThreadPayloadLabel(undefined, 't1')).toEqual({});
  });
});
