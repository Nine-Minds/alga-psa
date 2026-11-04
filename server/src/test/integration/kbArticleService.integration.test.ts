/**
 * REST KbArticleService paths for T0-9a (alga-2026-0002893):
 * C1 client visibility follows status/audience, C3 create-from-ticket uses the real description
 * and writes atomically.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

let db: Knex;
let tenantId: string;
let userId: string;
let service: import('../../lib/api/services/KbArticleService').KbArticleService;
const created: string[] = [];

const table = (name: string) => tenantDb(db, tenantId).table(name);
const ctx = () => ({ tenant: tenantId, userId });

async function newArticle(title: string, audience: 'internal' | 'client' | 'public') {
  const a = await service.create({ title, audience, article_type: 'how_to' } as never, ctx());
  created.push(a.article_id);
  return a as { article_id: string; document_id: string };
}
async function flag(documentId: string) {
  return (await table('documents').where({ document_id: documentId }).first()).is_client_visible as boolean;
}

describe('KbArticleService (REST) integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection();
    tenantId = await createTenant(db, 'KB Service Test Tenant');
    userId = await createUser(db, tenantId, { username: 'kb-svc-author' });
    const mod = await import('../../lib/api/services/KbArticleService');
    service = new mod.KbArticleService();
    // BaseService resolves its connection through an internal createTenantKnex; point it at the test DB.
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  }, 120_000);

  afterAll(async () => {
    for (const id of created) {
      const row = await table('kb_articles').where({ article_id: id }).first().catch(() => null);
      await table('kb_articles').where({ article_id: id }).del().catch(() => undefined);
      if (row) {
        await table('document_block_content').where({ document_id: row.document_id }).del().catch(() => undefined);
        await table('documents').where({ document_id: row.document_id }).del().catch(() => undefined);
      }
    }
    await db?.destroy();
  });

  describe('C1', () => {
    it('create writes is_client_visible=false', async () => {
      const a = await newArticle('svc create', 'client');
      expect(await flag(a.document_id)).toBe(false);
    });

    it('update of audience re-derives the flag both ways', async () => {
      const a = await newArticle('svc audience', 'client');
      await service.publish(a.article_id, ctx());
      expect(await flag(a.document_id)).toBe(true);

      await service.update(a.article_id, { audience: 'internal' } as never, ctx());
      expect(await flag(a.document_id)).toBe(false);

      await service.update(a.article_id, { audience: 'public' } as never, ctx());
      expect(await flag(a.document_id)).toBe(true);
    });

    it('update status back to draft hides a published client article', async () => {
      const a = await newArticle('svc draft', 'client');
      await service.publish(a.article_id, ctx());
      await service.update(a.article_id, { status: 'draft' } as never, ctx());
      expect(await flag(a.document_id)).toBe(false);
    });

    it('publish of an internal article clears a stale true flag', async () => {
      const a = await newArticle('svc stale', 'internal');
      await table('documents').where({ document_id: a.document_id }).update({ is_client_visible: true });
      await service.publish(a.article_id, ctx());
      expect(await flag(a.document_id)).toBe(false);
    });

    it('archive clears the flag', async () => {
      const a = await newArticle('svc archive', 'client');
      await service.publish(a.article_id, ctx());
      await service.archive(a.article_id, ctx());
      expect(await flag(a.document_id)).toBe(false);
    });
  });

  describe('C3', () => {
    async function ticketWith(attributes: Record<string, unknown> | null): Promise<string> {
      const clientId = uuidv4(); const boardId = uuidv4(); const priorityId = uuidv4();
      const statusId = uuidv4(); const ticketId = uuidv4();
      await table('clients').insert({
        tenant: tenantId, client_id: clientId, client_name: `svc ${clientId.slice(0, 6)}`, billing_cycle: 'monthly',
        is_tax_exempt: false, created_at: db.fn.now(), updated_at: db.fn.now(),
      });
      await table('boards').insert({ tenant: tenantId, board_id: boardId, board_name: `B ${boardId.slice(0, 6)}`, is_default: false, is_inactive: false });
      await table('priorities').insert({
        tenant: tenantId, priority_id: priorityId, priority_name: `P ${priorityId.slice(0, 6)}`, item_type: 'ticket',
        color: '#EF4444', order_number: 10, created_by: userId, created_at: db.fn.now(), updated_at: db.fn.now(),
      });
      await table('statuses').insert({
        tenant: tenantId, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket',
        is_closed: false, is_default: true, order_number: 10, created_by: userId, created_at: db.fn.now(),
      });
      await table('tickets').insert({
        tenant: tenantId, ticket_id: ticketId, ticket_number: `SVC-${ticketId.slice(0, 8)}`, title: 'VPN drops',
        client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId,
        entered_by: userId, entered_at: db.fn.now(), updated_at: db.fn.now(),
        attributes: attributes === null ? null : JSON.stringify(attributes),
      });
      return ticketId;
    }
    async function blocks(articleId: string): Promise<any[]> {
      const a = await table('kb_articles').where({ article_id: articleId }).first();
      const row = await table('document_block_content').where({ document_id: a.document_id }).first();
      return typeof row.block_data === 'string' ? JSON.parse(row.block_data) : row.block_data;
    }

    it('splices BlockNote description blocks under Problem', async () => {
      const desc = [{ type: 'paragraph', content: [{ type: 'text', text: 'Tunnel flaps', styles: { italic: true } }] }];
      const a = await service.createFromTicket(await ticketWith({ description: JSON.stringify(desc) }), ctx());
      created.push(a.article_id);
      const b = await blocks(a.article_id);
      expect(b[0].content[0].text).toBe('Problem');
      expect(b[1]).toEqual(desc[0]);
      expect(b[2].content[0].text).toBe('Resolution');
    });

    it('uses a paragraph for plain text and the placeholder for none', async () => {
      const plain = await service.createFromTicket(await ticketWith({ description: 'Plain words' }), ctx());
      created.push(plain.article_id);
      expect((await blocks(plain.article_id))[1].content[0].text).toBe('Plain words');

      const none = await service.createFromTicket(await ticketWith(null), ctx());
      created.push(none.article_id);
      expect((await blocks(none.article_id))[1].content[0].text).toBe('No description provided.');
    });

    it('create leaves no orphan document when the article insert fails', async () => {
      const title = `svc orphan ${uuidv4()}`;
      await expect(
        service.create({ title, article_type: 'how_to', audience: 'internal', review_cycle_days: 1_000_000_000_000, content_format: 'markdown', content: `body ${title}` } as never, ctx()),
      ).rejects.toThrow();
      expect(await table('documents').where({ document_name: title })).toHaveLength(0);
      expect(await table('document_block_content').whereRaw('block_data::text like ?', [`%${title}%`])).toHaveLength(0);
    });
  });
});
