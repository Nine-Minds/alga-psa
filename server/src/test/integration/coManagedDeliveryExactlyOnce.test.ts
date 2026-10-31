import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import pg from 'pg';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { CO_MANAGED_LEDGER, claimDelivery, finishDelivery } from '@shared/lib/deliveryLedger';
import { coManagedDeliverySeam, coManagedInboundCommentSeam, coManagedInboundOperationId, type RoutingDelivery, type CoManagedDeliveryProvider } from '@shared/lib/coManagedDelivery';

const h = vi.hoisted(() => ({ conn: null as any, sent: [] as string[], crashAfterClaim: false }));
vi.mock('../../lib/db/db', () => ({ getConnection: async () => h.conn }));
// Provider boundary stubs. Both honour the real ledger protocol (claimDelivery / finishDelivery) exactly as the
// production senders do, so the assertions exercise the real co_management_deliveries table.
vi.mock('../../lib/notifications/sendEventEmail', () => ({
  sendEventEmail: async (o: any) => {
    const { claimDelivery, finishDelivery } = await import('@shared/lib/deliveryLedger');
    const t = o.delivery.ledgerTenant;
    if (!(await claimDelivery(h.conn, o.delivery.ledger, t, o.delivery.key, o.delivery.extra))) return;
    if (h.crashAfterClaim) throw new Error('worker died between claim and finish');
    h.sent.push(`email:${o.to}`);
    await finishDelivery(h.conn, o.delivery.ledger, t, o.delivery.key, 'sent');
  },
}));
vi.mock('@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions', () => ({
  createNotificationFromTemplateInternal: async (_c: any, req: any, o: any) => {
    const { claimDelivery, finishDelivery } = await import('@shared/lib/deliveryLedger');
    await h.conn.transaction(async (trx: Knex.Transaction) => {
      if (!(await claimDelivery(trx, o.delivery.ledger, o.delivery.ledgerTenant, o.delivery.key, o.delivery.extra))) return;
      h.sent.push(`in_app:${req.user_id}`);
      await finishDelivery(trx, o.delivery.ledger, o.delivery.ledgerTenant, o.delivery.key, 'sent');
    });
  },
}));

import { recoverRoutingForTenant } from '../../lib/co-managed/routingRecovery';
import { deliverRouting } from '../../lib/notifications/coManagedRoutingDelivery';

describe('co-managed delivery: exactly once, query cost, kill switch (migrated PostgreSQL)', () => {
  let conn: Knex;
  const tenant = randomUUID();
  const ledger = (kind: string, source: string, recipient: string) => ({ delivery_kind: kind, source_id: source, recipient });
  const rowsOf = (source: string) => conn('co_management_deliveries').where({ tenant, source_id: source }).orderBy('recipient');

  const route = (source: string, kind: 'routing_in_app' | 'routing_email', who: string): RoutingDelivery => ({
    tenant, deliveryKind: kind, sourceId: source, event: 'escalation_received',
    recipient: { kind: 'msp_user', principalId: who, email: kind === 'routing_email' ? `${who}@example.test` : undefined } as any,
    recipientTenant: tenant, ticketId: randomUUID(), ticketNumber: 'T-1', ticketTitle: 'Printer', actorName: 'Ann', actorOrganization: 'Acme', allowed: true,
  });
  /** A provider whose pendingRouting reads the REAL ledger rows (pending/failed only), like the production provider. */
  const provider = (rows: Map<string, RoutingDelivery>): CoManagedDeliveryProvider => ({
    pendingRouting: async (t, o) => {
      const waiting = await conn('co_management_deliveries').where({ tenant: t }).whereIn('state', ['pending', 'failed'])
        .modify(q => { if (o?.sourceId) q.where('source_id', o.sourceId); });
      return waiting.map(r => rows.get(`${r.delivery_kind}|${r.source_id}|${r.recipient}`)!).filter(Boolean);
    },
    flagStaleRoutingSending: async (t, ms) => conn('co_management_deliveries').where({ tenant: t, state: 'sending' })
      .whereIn('delivery_kind', ['routing_in_app', 'routing_email']).where('updated_at', '<', new Date(Date.now() - ms)).update({ requires_reconciliation: true }),
  } as unknown as CoManagedDeliveryProvider);
  async function seedPending(rows: RoutingDelivery[]) {
    const map = new Map<string, RoutingDelivery>();
    for (const r of rows) {
      const recipient = r.recipient.email ?? r.recipient.principalId;
      await conn('co_management_deliveries').insert({ tenant, delivery_kind: r.deliveryKind, source_id: r.sourceId, recipient, recipient_kind: 'msp_user', state: 'pending', attempts: 0 });
      map.set(`${r.deliveryKind}|${r.sourceId}|${recipient}`, r);
    }
    return map;
  }

  beforeAll(async () => { conn = await createTestDbConnection(); h.conn = conn; });
  afterAll(async () => { await conn?.destroy(); });
  beforeEach(() => { h.sent.length = 0; h.crashAfterClaim = false; delete process.env.FORCE_CAPABILITIES; coManagedDeliverySeam.reset(); });
  afterEach(async () => { await conn('co_management_deliveries').where({ tenant }).delete(); process.env.FORCE_CAPABILITIES = ''; coManagedDeliverySeam.reset(); });

  describe('exactly once per audience, in-app and email', () => {
    it.each(['comment_in_app', 'comment_email'])('%s: a replayed TICKET_COMMENT_ADDED claims each recipient once', async kind => {
      const source = randomUUID();
      const wins: boolean[] = [];
      for (let replay = 0; replay < 3; replay++) {
        for (const who of ['a@example.test', 'b@example.test']) {
          if (await claimDelivery(conn, CO_MANAGED_LEDGER, tenant, ledger(kind, source, who), { recipient_kind: 'msp_user' })) {
            wins.push(true); await finishDelivery(conn, CO_MANAGED_LEDGER, tenant, ledger(kind, source, who), 'sent');
          }
        }
      }
      expect(wins).toHaveLength(2);
      expect((await rowsOf(source)).map(r => r.state)).toEqual(['sent', 'sent']);
    });

    it('concurrent claims for one recipient: exactly one owner', async () => {
      const source = randomUUID();
      const results = await Promise.all(Array.from({ length: 8 }, () => claimDelivery(conn, CO_MANAGED_LEDGER, tenant, ledger('comment_email', source, 'x@example.test'), { recipient_kind: 'customer_user' })));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('a retried routing event (in-app and email) delivers each owed row once', async () => {
      const source = randomUUID();
      const rows = [route(source, 'routing_in_app', 'u1'), route(source, 'routing_email', 'u1')];
      const p = provider(await seedPending(rows));
      process.env.FORCE_CAPABILITIES = 'co-managed:on';
      await deliverRouting(p, tenant, { sourceId: source });
      await deliverRouting(p, tenant, { sourceId: source }); // the retried event
      await deliverRouting(p, tenant, {});                   // recovery sweeping the same rows
      expect(h.sent.sort()).toEqual(['email:u1@example.test', 'in_app:u1']);
      expect((await rowsOf(source)).map(r => r.state)).toEqual(['sent', 'sent']);
    });

    it('a crash between claim and finish leaves the row sending: never re-sent, flagged for reconciliation', async () => {
      const source = randomUUID();
      const p = provider(await seedPending([route(source, 'routing_email', 'u2')]));
      process.env.FORCE_CAPABILITIES = 'co-managed:on';
      h.crashAfterClaim = true;
      expect((await deliverRouting(p, tenant, { sourceId: source })).failed).toBe(1);
      h.crashAfterClaim = false;
      await deliverRouting(p, tenant, {}); await deliverRouting(p, tenant, { sourceId: source });
      expect(h.sent).toEqual([]);
      const [row] = await rowsOf(source);
      expect(row.state).toBe('sending');
      await conn('co_management_deliveries').where({ tenant, source_id: source }).update({ updated_at: new Date(Date.now() - 3_600_000) });
      expect(await p.flagStaleRoutingSending(tenant, 15 * 60_000)).toBe(1);
      expect((await rowsOf(source))[0]).toMatchObject({ state: 'sending', requires_reconciliation: true });
      await deliverRouting(p, tenant, {});
      expect(h.sent).toEqual([]);
    });

    it('a failed row is retried once; a duplicate delivery key cannot be inserted twice', async () => {
      const source = randomUUID(), key = ledger('routing_email', source, 'f@example.test'), extra = { recipient_kind: 'msp_user' };
      expect(await claimDelivery(conn, CO_MANAGED_LEDGER, tenant, key, extra)).toBe(true);
      await finishDelivery(conn, CO_MANAGED_LEDGER, tenant, key, 'failed', { error: 'smtp 451' });
      expect(await claimDelivery(conn, CO_MANAGED_LEDGER, tenant, key, extra)).toBe(true);
      expect(await claimDelivery(conn, CO_MANAGED_LEDGER, tenant, key, extra)).toBe(false);
      await expect(conn('co_management_deliveries').insert({ tenant, ...key, recipient_kind: 'msp_user' })).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('a duplicate inbound message maps to the same operation id (the writer receipt then replays, never re-creates)', () => {
    const t = randomUUID(), ticket = randomUUID();
    expect(coManagedInboundOperationId(t, ticket, '<m1@x>')).toBe(coManagedInboundOperationId(t, ticket, '<m1@x>'));
    expect(coManagedInboundOperationId(t, ticket, '<m1@x>')).not.toBe(coManagedInboundOperationId(t, ticket, '<m2@x>'));
  });

  describe('kill switch: FORCE_CAPABILITIES=co-managed:off', () => {
    it('rows wait while forced off, then drain exactly once when lifted', async () => {
      const source = randomUUID();
      const p = provider(await seedPending([route(source, 'routing_in_app', 'k1'), route(source, 'routing_email', 'k1')]));
      coManagedDeliverySeam.register(() => p);
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      const { invalidateCapability } = await import('@alga-psa/core/capability');
      invalidateCapability('co-managed');
      expect(await recoverRoutingForTenant(tenant)).toMatchObject({ sent: 0 });
      expect(h.sent).toEqual([]);
      expect((await rowsOf(source)).map(r => r.state)).toEqual(['pending', 'pending']);

      process.env.FORCE_CAPABILITIES = 'co-managed:on';
      invalidateCapability('co-managed');
      expect(await recoverRoutingForTenant(tenant)).toMatchObject({ sent: 2 });
      await recoverRoutingForTenant(tenant);
      expect(h.sent.sort()).toEqual(['email:k1@example.test', 'in_app:k1']);
      expect((await rowsOf(source)).map(r => r.state)).toEqual(['sent', 'sent']);
    });
  });

  describe('query cost for a plain PSA tenant', () => {
    function countStatements() {
      const original = pg.Client.prototype.query;
      const seen: string[] = [];
      (pg.Client.prototype as any).query = function (this: unknown, ...args: any[]) {
        const first = args[0]; seen.push(typeof first === 'string' ? first : first?.text ?? '<unknown>');
        return (original as any).apply(this, args);
      };
      return { seen, stop: () => { (pg.Client.prototype as any).query = original; } };
    }
    it('control: the counter observes statements', async () => {
      const c = countStatements();
      try { await conn.raw('select 1'); } finally { c.stop(); }
      expect(c.seen.length).toBeGreaterThan(0);
    });
    it('no provider registered (flag off / package absent): 0 statements for the delivery, inbound and workflow seams', async () => {
      const c = countStatements();
      try {
        expect(await coManagedDeliverySeam.resolve(tenant)).toBeNull();
        expect(await coManagedInboundCommentSeam.resolve(tenant)).toBeNull();
      } finally { c.stop(); }
      expect(c.seen).toEqual([]);
    });
    it('provider registered but tenant not served (forced off): 0 statements, and no co_management_* SQL', async () => {
      coManagedDeliverySeam.register(() => { throw new Error('provider must not be constructed for a non-served tenant'); });
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      const { invalidateCapability } = await import('@alga-psa/core/capability');
      invalidateCapability('co-managed');
      const c = countStatements();
      try {
        for (let i = 0; i < 5; i++) expect(await coManagedDeliverySeam.resolve(tenant)).toBeNull(); // 5 comment adds / inbound messages
        expect(await recoverRoutingForTenant(tenant)).toMatchObject({ sent: 0 });
      } finally { c.stop(); }
      expect(c.seen.filter(s => /co_management_/.test(s))).toEqual([]);
      expect(c.seen).toEqual([]);
    });
  });
});
