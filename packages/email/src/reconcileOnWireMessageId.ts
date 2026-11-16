/**
 * Asynchronous half of the on-wire Message-ID contract (see onWireMessageId.ts for the contract and
 * the list of stored copies of the generated id that get rewritten).
 */

import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { normalizeRfc822MessageId } from '@alga-psa/shared/services/email/inboundEmailIdentity';
import {
  hasRecordedOnWireId,
  parseJsonObject,
  sameMessageId,
  toBracketedMessageId,
} from './onWireMessageId';

export interface ReconcileOnWireMessageIdInput {
  tenant: string;
  /** The provider's own id for the send (Resend `email_id`), matched together with tenant. */
  providerMessageId: string;
  /** The Message-ID header the message carries on the wire. */
  onWireMessageId: string;
}

export type ReconcileOnWireMessageIdStatus =
  /** Row now holds the on-wire id (and stored copies were rewritten). */
  | 'recorded'
  /** Row already held this on-wire id; nothing changed. */
  | 'unchanged'
  /** Row already held a different on-wire id; kept the first, logged a warning. */
  | 'conflict'
  /** No row for this tenant + provider_message_id. */
  | 'not_found'
  /** Input unusable (empty tenant/provider id, malformed on-wire id). */
  | 'invalid';

export interface ReconcileOnWireMessageIdResult {
  status: ReconcileOnWireMessageIdStatus;
  rowsMatched: number;
  rowsRecorded: number;
}

interface LogRow {
  id: number | string;
  rfc_message_id: string | null;
  metadata: Record<string, any> | string | null;
  entity_type: string | null;
  entity_id: string | null;
  comment_thread_id: string | null;
}

/**
 * SQL twin of `normalizeRfc822MessageId` (shared/services/email/inboundEmailIdentity.ts) for a text
 * expression: trim, drop one surrounding `<>` pair, drop leading `rfc822:` prefixes, lower-case the domain;
 * NULL when nothing is left. `expr` is always an internal column/alias reference, never input.
 * The parity is pinned by onWireMessageIdStoredCopies.integration.test.ts.
 */
export function normalizedMessageIdSql(expr: string): string {
  return `(SELECT CASE WHEN strpos(n3.v, '@') > 1
      THEN left(n3.v, strpos(n3.v, '@') - 1) || '@' || lower(substr(n3.v, strpos(n3.v, '@') + 1))
      ELSE NULLIF(n3.v, '') END
    FROM (SELECT regexp_replace(n2.v, '^(rfc822:\\s*)+', '') AS v
      FROM (SELECT CASE WHEN length(n1.v) > 2 AND left(n1.v, 1) = '<' AND right(n1.v, 1) = '>'
              THEN regexp_replace(substr(n1.v, 2, length(n1.v) - 2), '^\\s+|\\s+$', '', 'g') ELSE n1.v END AS v
        FROM (SELECT regexp_replace(${expr}, '^\\s+|\\s+$', '', 'g') AS v) n1) n2) n3)`;
}

/**
 * Set-based twin of `replaceMessageIdInList` over a relation `elements(e text, ord bigint)`: replace the
 * element equal (normalized) to binding #1 with binding #2, keep order, drop later duplicates (by
 * normalized key), skip NULL elements. Evaluates to the rebuilt rows `(v, ord)`; two bindings.
 */
function replacedElementsSql(elements: string): string {
  const key = `COALESCE(${normalizedMessageIdSql('r.v')}, r.v)`;
  return `SELECT DISTINCT ON (${key}) r.v, r.ord
    FROM (SELECT CASE WHEN ${normalizedMessageIdSql('el.e')} = ? THEN ? ELSE el.e END AS v, el.ord
      FROM (${elements}) el WHERE el.e IS NOT NULL) r
    ORDER BY ${key}, r.ord`;
}

const COMMENT_THREAD_REFERENCES = 'SELECT u.e, u.ord FROM unnest(email_references) WITH ORDINALITY AS u(e, ord)';
const TICKET_REFERENCES =
  "SELECT j.e #>> '{}' AS e, j.ord FROM jsonb_array_elements(CASE WHEN jsonb_typeof(email_metadata->'references') = 'array' THEN email_metadata->'references' ELSE '[]'::jsonb END) WITH ORDINALITY AS j(e, ord) WHERE jsonb_typeof(j.e) = 'string'";

/** Whether the element relation holds the generated id; one binding (the normalized generated id). */
const containsSql = (elements: string) =>
  `EXISTS (SELECT 1 FROM (${elements}) c WHERE ${normalizedMessageIdSql('c.e')} = ?)`;

/**
 * Rewrite every stored copy of the generated id (see onWireMessageId.ts (3)-(6)) with one UPDATE per
 * table. Matching and the element replacement happen in the statement itself, so nothing is read back
 * and the row lock is the UPDATE's own: a concurrent append either lands before (and is rewritten) or
 * after (and already carries the on-wire id). Only rows that hold the generated id are written.
 */
async function rewriteStoredCopies(
  trx: Knex.Transaction,
  tenant: string,
  row: LogRow,
  metadata: Record<string, any>,
  generated: string,
  onWire: string
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const generatedKey = normalizeRfc822MessageId(generated);
  if (!generatedKey) return;
  const threadRefsMatch = containsSql(COMMENT_THREAD_REFERENCES);
  const ticketRefsMatch = containsSql(TICKET_REFERENCES);
  const messageIdMatch = (expr: string) => `${normalizedMessageIdSql(expr)} = ?`;

  // (3) + (4): the comment thread this send belongs to.
  if (row.comment_thread_id) {
    await db
      .table('comment_threads')
      .where({ thread_id: row.comment_thread_id })
      .whereRaw(`(${threadRefsMatch} OR ${messageIdMatch('email_message_id')})`, [generatedKey, generatedKey])
      .update({
        email_references: trx.raw(
          `CASE WHEN ${threadRefsMatch}
            THEN COALESCE((SELECT array_agg(d.v ORDER BY d.ord) FROM (${replacedElementsSql(COMMENT_THREAD_REFERENCES)}) d), '{}'::text[])
            ELSE email_references END`,
          [generatedKey, generatedKey, onWire]
        ),
        email_message_id: trx.raw(`CASE WHEN ${messageIdMatch('email_message_id')} THEN ? ELSE email_message_id END`, [
          generatedKey,
          onWire,
        ]),
      });
  }

  // (5) + (6): the ticket's accumulated reference chain and thread root. Only the affected keys change;
  // deliberately no updated_at / updated_by: email_metadata is bookkeeping (see appendOutboundMessageIdReference).
  const ticketIds = new Set<string>();
  if (row.entity_type === 'ticket' && row.entity_id) ticketIds.add(row.entity_id);
  const diagnosticTicketId = metadata?.algaDiagnostics?.outbound?.ticketId;
  if (typeof diagnosticTicketId === 'string' && diagnosticTicketId) ticketIds.add(diagnosticTicketId);
  if (ticketIds.size === 0) return;

  const threadRootMatch = `(jsonb_typeof(email_metadata->'threadRoot') = 'string' AND ${messageIdMatch("email_metadata->>'threadRoot'")})`;
  await db
    .table('tickets')
    .whereIn('ticket_id', [...ticketIds])
    .whereRaw(`jsonb_typeof(email_metadata) = 'object' AND (${ticketRefsMatch} OR ${threadRootMatch})`, [generatedKey, generatedKey])
    .update({
      email_metadata: trx.raw(
        `jsonb_set(
          CASE WHEN ${ticketRefsMatch}
            THEN jsonb_set(email_metadata, '{references}',
              COALESCE((SELECT jsonb_agg(to_jsonb(d.v) ORDER BY d.ord) FROM (${replacedElementsSql(TICKET_REFERENCES)}) d), '[]'::jsonb))
            ELSE email_metadata END,
          '{threadRoot}',
          CASE WHEN ${threadRootMatch} THEN to_jsonb(?::text) ELSE COALESCE(email_metadata->'threadRoot', 'null'::jsonb) END,
          jsonb_typeof(email_metadata->'threadRoot') IS NOT NULL
        )`,
        [generatedKey, generatedKey, onWire, generatedKey, onWire]
      ),
    });
}

/**
 * Asynchronous half of the contract: record the on-wire Message-ID for the send identified by
 * `tenant` + `providerMessageId`. Provider-agnostic, idempotent, and tenant-scoped on every query
 * (the table is distributed by tenant on Citus).
 *
 * Conflict rule: if the row already holds a *different* recorded on-wire id, the first one wins and a
 * warning is logged. It is never overwritten silently.
 */
export async function reconcileOnWireMessageId(
  knex: Knex | Knex.Transaction,
  input: ReconcileOnWireMessageIdInput
): Promise<ReconcileOnWireMessageIdResult> {
  const tenant = input.tenant?.trim();
  const providerMessageId = input.providerMessageId?.trim();
  const onWire = toBracketedMessageId(input.onWireMessageId);
  if (!tenant || !providerMessageId || !onWire) {
    return { status: 'invalid', rowsMatched: 0, rowsRecorded: 0 };
  }

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenant);
    const rows: LogRow[] = await db
      .table('email_sending_logs')
      .where({ provider_message_id: providerMessageId })
      .forUpdate()
      .select('id', 'rfc_message_id', 'metadata', 'entity_type', 'entity_id', 'comment_thread_id');

    if (rows.length === 0) {
      return { status: 'not_found' as const, rowsMatched: 0, rowsRecorded: 0 };
    }

    let recorded = 0;
    let conflicts = 0;
    for (const row of rows) {
      const metadata = parseJsonObject(row.metadata);

      if (hasRecordedOnWireId(metadata) || sameMessageId(row.rfc_message_id, onWire)) {
        const current = row.rfc_message_id;
        if (!sameMessageId(current, onWire)) {
          conflicts += 1;
          logger.warn('[onWireMessageId] row already holds a different on-wire Message-ID; keeping the first', {
            tenant,
            providerMessageId,
            logId: row.id,
            stored: current,
            offered: onWire,
          });
        }
        continue;
      }

      const generated = row.rfc_message_id?.trim() || null;
      const outbound = metadata?.algaDiagnostics?.outbound;
      const nextMetadata: Record<string, any> = {
        ...metadata,
        onWireMessageId: onWire,
        ...(generated ? { generatedRfcMessageId: generated } : {}),
        ...(outbound && typeof outbound === 'object'
          ? { algaDiagnostics: { ...metadata.algaDiagnostics, outbound: { ...outbound, rfcMessageId: onWire } } }
          : {}),
      };

      await db
        .table('email_sending_logs')
        .where({ id: row.id, provider_message_id: providerMessageId })
        .update({ rfc_message_id: onWire, metadata: nextMetadata });

      if (generated) {
        await rewriteStoredCopies(trx, tenant, row, metadata, generated, onWire);
      }
      recorded += 1;
    }

    const status: ReconcileOnWireMessageIdStatus =
      recorded > 0 ? 'recorded' : conflicts > 0 ? 'conflict' : 'unchanged';
    return { status, rowsMatched: rows.length, rowsRecorded: recorded };
  });
}
