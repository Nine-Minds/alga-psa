import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const backfillMigration = require('../../../migrations/20260918120000_backfill_bundle_mirror_comment_authors.cjs');

describe('bundle mirror comment author backfill migration', () => {
  let knex: Knex;
  let tenant: string;
  let userId: string;
  let baseTicket: any;

  const masterTicketId = uuidv4();
  const childTicketId = uuidv4();
  const sourceCommentId = uuidv4();
  const sourceThreadId = uuidv4();
  const childCommentId = uuidv4();
  const childThreadId = uuidv4();
  const unrelatedCommentId = uuidv4();
  const unrelatedThreadId = uuidv4();

  function table(name: string) {
    return tenantDb(knex, tenant).table(name);
  }

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const discovery = tenantDb(knex, '__test_discovery__');

    baseTicket = await discovery
      .unscoped('tickets', 'seed context for bundle mirror author backfill migration test')
      .first();
    userId = (
      await discovery
        .unscoped('users', 'seed author for bundle mirror author backfill migration test')
        .first('user_id')
    )?.user_id;
    tenant = baseTicket?.tenant;
    if (!baseTicket || !userId) {
      throw new Error('Missing seeded ticket/user context for bundle mirror backfill test');
    }

    const now = knex.fn.now();
    await table('tickets').insert([
      {
        tenant,
        ticket_id: masterTicketId,
        ticket_number: `BMA-${uuidv4().slice(0, 6)}`,
        title: 'Backfill master',
        client_id: baseTicket.client_id,
        contact_name_id: baseTicket.contact_name_id,
        status_id: baseTicket.status_id,
        priority_id: baseTicket.priority_id,
        board_id: baseTicket.board_id,
        entered_at: now,
        updated_at: now,
      },
      {
        tenant,
        ticket_id: childTicketId,
        ticket_number: `BMA-${uuidv4().slice(0, 6)}`,
        title: 'Backfill child',
        client_id: baseTicket.client_id,
        contact_name_id: baseTicket.contact_name_id,
        status_id: baseTicket.status_id,
        priority_id: baseTicket.priority_id,
        board_id: baseTicket.board_id,
        master_ticket_id: masterTicketId,
        entered_at: now,
        updated_at: now,
      },
    ]);

    await table('comment_threads').insert([
      {
        tenant,
        thread_id: sourceThreadId,
        ticket_id: masterTicketId,
        root_comment_id: sourceCommentId,
        is_internal: false,
        reply_count: 0,
        last_activity_at: now,
        created_at: now,
        created_by: userId,
      },
      {
        tenant,
        thread_id: childThreadId,
        ticket_id: childTicketId,
        root_comment_id: childCommentId,
        is_internal: false,
        reply_count: 0,
        last_activity_at: now,
        created_at: now,
        created_by: null,
      },
      {
        tenant,
        thread_id: unrelatedThreadId,
        ticket_id: childTicketId,
        root_comment_id: unrelatedCommentId,
        is_internal: false,
        reply_count: 0,
        last_activity_at: now,
        created_at: now,
        created_by: null,
      },
    ]);

    await table('comments').insert([
      {
        tenant,
        comment_id: sourceCommentId,
        thread_id: sourceThreadId,
        ticket_id: masterTicketId,
        user_id: userId,
        author_type: 'internal',
        note: 'Source update',
        is_internal: false,
        is_resolution: false,
        is_system_generated: false,
        created_at: now,
      },
      {
        tenant,
        comment_id: childCommentId,
        thread_id: childThreadId,
        ticket_id: childTicketId,
        user_id: null,
        contact_id: null,
        author_type: 'unknown',
        note: 'Source update',
        is_internal: false,
        is_resolution: false,
        is_system_generated: true,
        created_at: now,
      },
      {
        tenant,
        comment_id: unrelatedCommentId,
        thread_id: unrelatedThreadId,
        ticket_id: childTicketId,
        user_id: null,
        contact_id: null,
        author_type: 'unknown',
        note: 'Unrelated legacy comment',
        is_internal: false,
        is_resolution: false,
        is_system_generated: false,
        created_at: now,
      },
    ]);

    await table('ticket_bundle_mirrors').insert({
      tenant,
      source_comment_id: sourceCommentId,
      child_ticket_id: childTicketId,
      child_comment_id: childCommentId,
    });
  });

  afterAll(async () => {
    await knex?.destroy().catch(() => undefined);
  });

  it('backfills mirrored child comment author fields and thread created_by, leaving other comments untouched', async () => {
    await backfillMigration.up(knex);

    const child = await table('comments').where({ comment_id: childCommentId }).first();
    expect(child?.user_id).toBe(userId);
    expect(child?.author_type).toBe('internal');
    expect(child?.is_system_generated).toBe(true);

    const childThread = await table('comment_threads').where({ thread_id: childThreadId }).first();
    expect(childThread?.created_by).toBe(userId);

    const unrelated = await table('comments').where({ comment_id: unrelatedCommentId }).first();
    expect(unrelated?.user_id).toBeNull();
    expect(unrelated?.author_type).toBe('unknown');
    const unrelatedThread = await table('comment_threads').where({ thread_id: unrelatedThreadId }).first();
    expect(unrelatedThread?.created_by).toBeNull();
  });

  it('is idempotent when rerun', async () => {
    await backfillMigration.up(knex);

    const child = await table('comments').where({ comment_id: childCommentId }).first();
    expect(child?.user_id).toBe(userId);
    expect(child?.author_type).toBe('internal');
    const childThread = await table('comment_threads').where({ thread_id: childThreadId }).first();
    expect(childThread?.created_by).toBe(userId);
  });

  it('down reverts only the mirrored child rows', async () => {
    await backfillMigration.down(knex);

    const child = await table('comments').where({ comment_id: childCommentId }).first();
    expect(child?.user_id).toBeNull();
    expect(child?.contact_id).toBeNull();
    expect(child?.author_type).toBe('unknown');
    const childThread = await table('comment_threads').where({ thread_id: childThreadId }).first();
    expect(childThread?.created_by).toBeNull();

    // The source comment is not mirrored and must be untouched.
    const source = await table('comments').where({ comment_id: sourceCommentId }).first();
    expect(source?.user_id).toBe(userId);
    expect(source?.author_type).toBe('internal');
  });
});
