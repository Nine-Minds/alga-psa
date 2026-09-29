import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessageDetails } from '../../../interfaces/inbound-email.interfaces';

/**
 * Direct unit tests for notificationLoopDetection.ts against a query-builder
 * double that ACTUALLY APPLIES the where()/andWhereRaw() predicates to a
 * seeded row set (unlike the canned-single-row mocks used elsewhere in the
 * inbound-email test suite). This is what lets these tests prove the Tier 2
 * fallback query evaluates candidates correctly rather than just taking
 * whichever row a test hands it — in particular, that it selects the
 * matching row even when it is NOT the most recent send from that sender.
 */

function replyTokenHash(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

interface FakeLogRow {
  id: number;
  tenant: string;
  status: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses?: string[] | null;
  bcc_addresses?: string[] | null;
  entity_type: string | null;
  entity_id: string | null;
  subject: string;
  created_at: string;
  reply_token_hash?: string | null;
}

let seededRows: FakeLogRow[] = [];

function normalizeSubjectForTestDouble(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Chainable query-builder double that mirrors the subset of knex used by
 * notificationLoopDetection.ts, applying every where()/andWhereRaw()
 * predicate to the row set given to it (already tenant-scoped, mirroring
 * tenantDb()'s transparent tenant filter) rather than ignoring the
 * predicates and returning a canned value.
 */
function createFilteringQueryBuilder(rows: FakeLogRow[]) {
  const predicates: Array<(row: FakeLogRow) => boolean> = [];
  let orderDirection: 'asc' | 'desc' = 'asc';

  const builder: any = {
    select: (..._cols: string[]) => builder,
    where: (criteria: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(criteria)) {
        predicates.push((row) => (row as any)[key] === value);
      }
      return builder;
    },
    andWhereRaw: (sql: string, bindings: unknown[]) => {
      const lowerSql = sql.toLowerCase();
      if (lowerSql.includes('from_address')) {
        const target = String(bindings[0]).toLowerCase();
        predicates.push((row) => row.from_address.toLowerCase() === target);
      } else if (lowerSql.includes('regexp_replace(trim(subject')) {
        const target = String(bindings[0]);
        predicates.push((row) => normalizeSubjectForTestDouble(row.subject) === target);
      } else if (lowerSql.includes('jsonb_array_elements_text')) {
        const target = String(bindings[0]).toLowerCase();
        predicates.push((row) => {
          const all = [
            ...(row.to_addresses ?? []),
            ...(row.cc_addresses ?? []),
            ...(row.bcc_addresses ?? []),
          ];
          return all.some((email) => email.toLowerCase() === target);
        });
      } else if (lowerSql.includes('created_at')) {
        const since = String(bindings[0]);
        predicates.push((row) => row.created_at >= since);
      } else {
        throw new Error(`Unrecognized andWhereRaw predicate in test double: ${sql}`);
      }
      return builder;
    },
    orderBy: (_column: string, direction: 'asc' | 'desc') => {
      orderDirection = direction;
      return builder;
    },
    first: async () => {
      const matches = rows.filter((row) => predicates.every((predicate) => predicate(row)));
      matches.sort((a, b) => {
        const cmp = a.created_at.localeCompare(b.created_at);
        return orderDirection === 'desc' ? -cmp : cmp;
      });
      return matches[0] ?? null;
    },
  };

  return builder;
}

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: async (callback: (trx: any) => Promise<any>) => callback({}),
  tenantDb: (_trx: any, tenant: string) => ({
    table: (name: string) => {
      if (name !== 'email_sending_logs') {
        throw new Error(`Unexpected table in notificationLoopDetection unit test: ${name}`);
      }
      // Mirrors tenantDb()'s transparent tenant scoping: the row set handed
      // to the rest of the query chain is already narrowed to this tenant.
      return createFilteringQueryBuilder(seededRows.filter((row) => row.tenant === tenant));
    },
  }),
}));

function buildEmailData(overrides: Partial<EmailMessageDetails> = {}): EmailMessageDetails {
  return {
    id: 'email-1',
    provider: 'imap',
    providerId: 'provider-1',
    tenant: 'tenant-1',
    receivedAt: '2026-02-11T00:00:00.000Z',
    from: { email: 'hello@jayscomputers.com.au' },
    to: [{ email: 'jamie@jayscomputers.com.au' }],
    subject: 'Ticket Updated: TK-1',
    body: { text: 'Full template body.' },
    attachments: [],
    ...overrides,
  };
}

describe('detectOutboundNotificationLoop', () => {
  beforeEach(() => {
    seededRows = [];
  });

  it('Tier 2 selects the matching candidate even when it is NOT the most recent send from that sender', async () => {
    // A later, unrelated notification from the same sender to a different
    // recipient/subject must not shadow the actually-redelivered one just
    // because it is more recent — the fallback query is required to filter
    // on recipient+subject, not merely take the newest row from the sender.
    seededRows = [
      {
        id: 1,
        tenant: 'tenant-1',
        status: 'sent',
        from_address: 'hello@jayscomputers.com.au',
        to_addresses: ['jamie@jayscomputers.com.au'],
        entity_type: 'ticket',
        entity_id: 'ticket-old',
        subject: 'Ticket Updated: TK-100',
        created_at: '2026-02-10T00:00:00.000Z',
        reply_token_hash: null,
      },
      {
        id: 2,
        tenant: 'tenant-1',
        status: 'sent',
        from_address: 'hello@jayscomputers.com.au',
        to_addresses: ['someone-else@jayscomputers.com.au'],
        entity_type: 'ticket',
        entity_id: 'ticket-unrelated-newer',
        subject: 'Ticket Assigned: TK-999',
        created_at: '2026-02-12T00:00:00.000Z',
        reply_token_hash: null,
      },
    ];

    const { detectOutboundNotificationLoop } = await import('../notificationLoopDetection');
    const result = await detectOutboundNotificationLoop({
      tenantId: 'tenant-1',
      emailData: buildEmailData({
        subject: 'Ticket Updated: TK-100',
        headers: {
          'auto-submitted': 'auto-generated',
          'x-auto-response-suppress': 'OOF, AutoReply, AutoForward',
        },
      }),
      senderEmail: 'hello@jayscomputers.com.au',
      providerMailboxEmail: 'jamie@jayscomputers.com.au',
      conversationToken: undefined, // force Tier 2 (no token extracted)
      now: new Date('2026-02-13T00:00:00.000Z'),
    });

    expect(result.isLoop).toBe(true);
    expect(result.tier).toBe('automated_header_ledger_fallback');
    expect(result.matchedLogId).toBe(1);
    expect(result.matchedEntityId).toBe('ticket-old');
  });

  it('Tier 2 does not suppress when no candidate matches recipient+subject, even with a same-sender row present', async () => {
    seededRows = [
      {
        id: 3,
        tenant: 'tenant-1',
        status: 'sent',
        from_address: 'hello@jayscomputers.com.au',
        to_addresses: ['someone-else@jayscomputers.com.au'],
        entity_type: 'ticket',
        entity_id: 'ticket-unrelated',
        subject: 'Ticket Assigned: TK-999',
        created_at: '2026-02-10T00:00:00.000Z',
        reply_token_hash: null,
      },
    ];

    const { detectOutboundNotificationLoop } = await import('../notificationLoopDetection');
    const result = await detectOutboundNotificationLoop({
      tenantId: 'tenant-1',
      emailData: buildEmailData({
        subject: 'Ticket Updated: TK-100',
        headers: { 'auto-submitted': 'auto-generated' },
      }),
      senderEmail: 'hello@jayscomputers.com.au',
      providerMailboxEmail: 'jamie@jayscomputers.com.au',
      conversationToken: undefined,
      now: new Date('2026-02-13T00:00:00.000Z'),
    });

    expect(result.isLoop).toBe(false);
  });

  it('Tier 1 requires an automated signal or exact subject match in addition to sender+recipient (does not suppress a "Re:"-prefixed human reply from the shared mailbox)', async () => {
    const token = 'shared-mailbox-reply-token';
    seededRows = [
      {
        id: 4,
        tenant: 'tenant-1',
        status: 'sent',
        from_address: 'hello@jayscomputers.com.au',
        to_addresses: ['jamie@jayscomputers.com.au'],
        entity_type: 'ticket',
        entity_id: 'ticket-probe',
        subject: 'Ticket Updated: TK-PROBE',
        created_at: '2026-02-10T00:00:00.000Z',
        reply_token_hash: replyTokenHash(token),
      },
    ];

    const { detectOutboundNotificationLoop } = await import('../notificationLoopDetection');
    const result = await detectOutboundNotificationLoop({
      tenantId: 'tenant-1',
      emailData: buildEmailData({
        subject: 'Re: Ticket Updated: TK-PROBE',
        // No automated headers: a human's mail client did not add them.
        headers: {},
      }),
      senderEmail: 'hello@jayscomputers.com.au',
      providerMailboxEmail: 'jamie@jayscomputers.com.au',
      conversationToken: token,
    });

    expect(result.isLoop).toBe(false);
    expect(result.evidence.senderMatchesLoggedFromAddress).toBe(true);
    expect(result.evidence.recipientMatchedLoggedSend).toBe(true);
    expect(result.evidence.subjectMatchedLoggedSend).toBe(false);
    expect(result.evidence.automated.isAutomated).toBe(false);
  });

  it('Tier 1 suppresses when sender+recipient match AND the subject is byte-identical (even without automated headers)', async () => {
    const token = 'exact-subject-loop-token';
    seededRows = [
      {
        id: 5,
        tenant: 'tenant-1',
        status: 'sent',
        from_address: 'hello@jayscomputers.com.au',
        to_addresses: ['jamie@jayscomputers.com.au'],
        entity_type: 'ticket',
        entity_id: 'ticket-exact-subject',
        subject: 'Ticket Updated: TK-200',
        created_at: '2026-02-10T00:00:00.000Z',
        reply_token_hash: replyTokenHash(token),
      },
    ];

    const { detectOutboundNotificationLoop } = await import('../notificationLoopDetection');
    const result = await detectOutboundNotificationLoop({
      tenantId: 'tenant-1',
      emailData: buildEmailData({
        subject: 'Ticket Updated: TK-200',
        headers: {},
      }),
      senderEmail: 'hello@jayscomputers.com.au',
      providerMailboxEmail: 'jamie@jayscomputers.com.au',
      conversationToken: token,
    });

    expect(result.isLoop).toBe(true);
    expect(result.tier).toBe('reply_token_ledger');
    expect(result.matchedEntityId).toBe('ticket-exact-subject');
  });

  it('a ledger row from a different tenant is never visible to this tenant\'s lookup', async () => {
    seededRows = [
      {
        id: 6,
        tenant: 'tenant-OTHER',
        status: 'sent',
        from_address: 'hello@jayscomputers.com.au',
        to_addresses: ['jamie@jayscomputers.com.au'],
        entity_type: 'ticket',
        entity_id: 'ticket-other-tenant',
        subject: 'Ticket Updated: TK-100',
        created_at: '2026-02-10T00:00:00.000Z',
        reply_token_hash: replyTokenHash('cross-tenant-token'),
      },
    ];

    const { detectOutboundNotificationLoop } = await import('../notificationLoopDetection');
    const result = await detectOutboundNotificationLoop({
      tenantId: 'tenant-1',
      emailData: buildEmailData({
        subject: 'Ticket Updated: TK-100',
        headers: { 'auto-submitted': 'auto-generated' },
      }),
      senderEmail: 'hello@jayscomputers.com.au',
      providerMailboxEmail: 'jamie@jayscomputers.com.au',
      conversationToken: 'cross-tenant-token',
    });

    expect(result.isLoop).toBe(false);
    expect(result.evidence.tokenHashMatched).toBe(false);
  });
});
