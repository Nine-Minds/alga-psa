/**
 * Ticket / ticket_comment search client scope, against a real DB:
 *  1. the migration backfills client_scope_id in SQL even after a live write moved the reconcile watermark;
 *  2. the SQL ACL predicate is strict for ticket types, so counts match results for a scoped principal.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import Comment from '../../../../packages/tickets/src/models/comment';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ticketIndexer } from '@alga-psa/search/indexers/ticket';
import { ticketCommentIndexer } from '@alga-psa/search/indexers/ticket_comment';
import { upsertSearchDoc } from '@alga-psa/search/upsert';
import { verifyResultVisibility, type SearchAclPrincipal } from '@alga-psa/search/acl';
import { countSearchMatchesByType, runSearchQuery } from '@alga-psa/search/query';
import {
  deleteRowsMissingFromSource,
  insertRowsMissingFromIndex,
  reindexRowsAfterWatermark,
} from '../../../../packages/jobs/src/lib/handlers/searchReconcileHandler';

const require = createRequire(import.meta.url);
const migration = require(
  path.resolve(__dirname, '../../../migrations/20261031120000_reindex_ticket_search_docs_client_scope.cjs'),
) as { up: (knex: Knex) => Promise<void> };

const TERM = 'pocketwatchzq';

describe('ticket search client scope (integration)', () => {
  let knex: Knex;
  let tenant: string;
  let ownClientId: string;
  let otherClientId: string;
  let ownTicketId: string;
  let otherTicketId: string;
  let newerTicketId: string;
  let ownCommentId: string;
  let otherCommentId: string;
  let tenantWideDocId: string;
  const createdTickets: string[] = [];
  const createdComments: string[] = [];

  const cloneRow = async (table: string, where: Record<string, unknown>, patch: Record<string, unknown>) => {
    const base = await knex(table).where(where).first();
    if (!base) throw new Error(`no seed row in ${table}`);
    await knex(table).insert({ ...base, ...patch });
  };

  const legacyDoc = (objectType: string, objectId: string, title: string) => ({
    tenant,
    object_type: objectType,
    object_id: objectId,
    title,
    url: `/x/${objectId}`,
    client_scope_id: null,
    required_permission: null,
    search_vector: knex.raw("to_tsvector('english', ?)", [title]),
    source_updated_at: new Date('2026-01-01T00:00:00.000Z'),
  });

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const seed = await knex('tickets').first('tenant', 'ticket_id', 'client_id');
    tenant = seed.tenant;
    ownClientId = uuidv4();
    otherClientId = uuidv4();
    for (const [id, name] of [[ownClientId, 'Scope Own Co'], [otherClientId, 'Scope Other Co']] as const) {
      await cloneRow('clients', { tenant, client_id: seed.client_id }, { client_id: id, client_name: `${name} ${id.slice(0, 6)}` });
    }
    const mkTicket = async (clientId: string, title: string) => {
      const id = uuidv4();
      await cloneRow('tickets', { tenant, ticket_id: seed.ticket_id }, {
        ticket_id: id,
        client_id: clientId,
        title,
        ticket_number: `SC-${id.slice(0, 8)}`,
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      });
      createdTickets.push(id);
      return id;
    };
    ownTicketId = await mkTicket(ownClientId, `${TERM} own ticket`);
    otherTicketId = await mkTicket(otherClientId, `${TERM} other ticket`);
    newerTicketId = await mkTicket(ownClientId, 'newer live ticket');

    const mkComment = async (ticketId: string, note: string) => {
      const userId = (await knex('users').where({ tenant }).first('user_id')).user_id;
      const id = await Comment.insert(knex, tenant, {
        ticket_id: ticketId,
        user_id: userId,
        author_type: 'internal',
        is_internal: false,
        note,
        markdown_content: note,
        is_resolution: false,
      } as any);
      createdComments.push(id);
      return id;
    };
    ownCommentId = await mkComment(ownTicketId, `${TERM} own comment`);
    otherCommentId = await mkComment(otherTicketId, `${TERM} other comment`);
    tenantWideDocId = `scope-test-${uuidv4()}`;

    await knex('app_search_index').insert([
      legacyDoc('ticket', ownTicketId, `${TERM} own ticket`),
      legacyDoc('ticket', otherTicketId, `${TERM} other ticket`),
      legacyDoc('ticket_comment', ownCommentId, `${TERM} own comment`),
      legacyDoc('ticket_comment', otherCommentId, `${TERM} other comment`),
      // A non-ticket NULL-scope doc: tenant-wide by design, must keep counting for scoped principals.
      legacyDoc('kb_article', tenantWideDocId, `${TERM} tenant wide article`),
    ]);
  }, 300_000);

  afterAll(async () => {
    if (!knex) return;
    await knex('app_search_index').where({ tenant })
      .whereIn('object_id', [...createdTickets, ...createdComments, tenantWideDocId]).delete().catch(() => undefined);
    await knex('comments').where({ tenant }).whereIn('comment_id', createdComments).delete().catch(() => undefined);
    await knex('tickets').where({ tenant }).whereIn('ticket_id', createdTickets).delete().catch(() => undefined);
    await knex('clients').where({ tenant }).whereIn('client_id', [ownClientId, otherClientId]).delete().catch(() => undefined);
    await knex.destroy().catch(() => undefined);
  });

  const scopeOf = async (objectType: string, objectId: string) =>
    (await knex('app_search_index').where({ tenant, object_type: objectType, object_id: objectId }).first('client_scope_id'))
      ?.client_scope_id ?? null;

  const principal = (overrides: Partial<SearchAclPrincipal>): SearchAclPrincipal => ({
    userId: uuidv4(),
    tenant,
    permissions: ['ticket:read', 'kb:read'],
    roles: [],
    isInternal: false,
    ...overrides,
  });

  const searchAs = async (acl: SearchAclPrincipal) => {
    const base = { knex, tenant, query: TERM, allowedTypes: ['ticket', 'ticket_comment', 'kb_article'] as any, acl };
    const [hits, groups] = await Promise.all([
      runSearchQuery({ ...base, limit: 50 }),
      countSearchMatchesByType(base),
    ]);
    const visible = await verifyResultVisibility(knex, acl, hits);
    return { groups, results: visible.map((h) => `${h.type}:${h.id}`) };
  };

  it('migration backfills client_scope_id even after a live write moved the reconcile watermark', async () => {
    await migration.up(knex);

    // Live indexing after deploy: moves MAX(source_updated_at) for ticket past every legacy row.
    const doc = await ticketIndexer.loadOne(knex, tenant, newerTicketId);
    expect(doc).not.toBeNull();
    await upsertSearchDoc(knex, { ...doc!, sourceUpdatedAt: new Date() });

    for (const indexer of [ticketIndexer, ticketCommentIndexer]) {
      await reindexRowsAfterWatermark(knex, tenant, indexer);
      await deleteRowsMissingFromSource(knex, tenant, indexer);
      await insertRowsMissingFromIndex(knex, tenant, indexer);
    }

    expect(await scopeOf('ticket', ownTicketId)).toBe(ownClientId);
    expect(await scopeOf('ticket', otherTicketId)).toBe(otherClientId);
    expect(await scopeOf('ticket_comment', ownCommentId)).toBe(ownClientId);
    expect(await scopeOf('ticket_comment', otherCommentId)).toBe(otherClientId);
  });

  describe('strict NULL-scope ACL for ticket types', () => {
    beforeAll(async () => {
      // Independent of the migration test: own docs are scoped, the other client's docs are legacy NULL-scope.
      await knex('app_search_index').where({ tenant })
        .whereIn('object_id', [ownTicketId, ownCommentId]).update({ client_scope_id: ownClientId });
      await knex('app_search_index').where({ tenant })
        .whereIn('object_id', [otherTicketId, otherCommentId]).update({ client_scope_id: null });
    });

    it('scoped portal principal gets no ticket signal from NULL-scope docs (counts and results)', async () => {
      const { groups, results } = await searchAs(principal({ clientAccess: { mode: 'scoped', clientIds: [ownClientId] } }));
      expect(groups.ticket).toBe(1); // own ticket only
      expect(groups.ticket_comment).toBe(1); // own comment only
      expect(groups.kb_article).toBe(1); // non-ticket NULL-scope doc is still tenant-wide
      expect(results).not.toContain(`ticket:${otherTicketId}`);
      expect(results).not.toContain(`ticket_comment:${otherCommentId}`);
    });

    it('a scoped principal on an unrelated client sees zero ticket counts', async () => {
      const { groups } = await searchAs(principal({ clientAccess: { mode: 'scoped', clientIds: [uuidv4()] } }));
      expect(groups.ticket ?? 0).toBe(0);
      expect(groups.ticket_comment ?? 0).toBe(0);
      expect(groups.kb_article).toBe(1);
    });

    it('internal / mode:all principals still count and see the NULL-scope docs', async () => {
      const { groups, results } = await searchAs(principal({ isInternal: true, clientAccess: { mode: 'all' } }));
      expect(groups.ticket).toBe(2);
      expect(groups.ticket_comment).toBe(2);
      expect(results).toContain(`ticket:${otherTicketId}`);
      expect(results).toContain(`ticket_comment:${otherCommentId}`);
    });
  });
});
