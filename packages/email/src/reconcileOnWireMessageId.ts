/**
 * Asynchronous half of the on-wire Message-ID contract (see onWireMessageId.ts for the contract and
 * the list of stored copies of the generated id that get rewritten).
 */

import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  hasRecordedOnWireId,
  parseJsonObject,
  parseTextArray,
  replaceMessageIdInList,
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

async function rewriteStoredCopies(
  trx: Knex.Transaction,
  tenant: string,
  row: LogRow,
  metadata: Record<string, any>,
  generated: string,
  onWire: string
): Promise<void> {
  const db = tenantDb(trx, tenant);

  // (3) + (4): the comment thread this send belongs to.
  if (row.comment_thread_id) {
    const thread = await db
      .table('comment_threads')
      .where({ thread_id: row.comment_thread_id })
      .forUpdate()
      .first('email_references', 'email_message_id');
    if (thread) {
      const update: Record<string, unknown> = {};
      const refs = replaceMessageIdInList(parseTextArray(thread.email_references), generated, onWire);
      if (refs) update.email_references = refs;
      if (typeof thread.email_message_id === 'string' && sameMessageId(thread.email_message_id, generated)) {
        update.email_message_id = onWire;
      }
      if (Object.keys(update).length > 0) {
        await db.table('comment_threads').where({ thread_id: row.comment_thread_id }).update(update);
      }
    }
  }

  // (5) + (6): the ticket's accumulated reference chain.
  const ticketIds = new Set<string>();
  if (row.entity_type === 'ticket' && row.entity_id) ticketIds.add(row.entity_id);
  const diagnosticTicketId = metadata?.algaDiagnostics?.outbound?.ticketId;
  if (typeof diagnosticTicketId === 'string' && diagnosticTicketId) ticketIds.add(diagnosticTicketId);

  for (const ticketId of ticketIds) {
    const ticket = await db
      .table('tickets')
      .where({ ticket_id: ticketId })
      .forUpdate()
      .first('email_metadata');
    const meta = parseJsonObject(ticket?.email_metadata);
    const refs = replaceMessageIdInList(meta.references, generated, onWire);
    const rootMatches = typeof meta.threadRoot === 'string' && sameMessageId(meta.threadRoot, generated);
    if (!refs && !rootMatches) continue;
    // Replace only the affected keys of the row we hold a lock on. Deliberately no updated_at /
    // updated_by: email_metadata is bookkeeping (see appendOutboundMessageIdReference).
    await db.table('tickets').where({ ticket_id: ticketId }).update({
      email_metadata: {
        ...meta,
        ...(refs ? { references: refs } : {}),
        ...(rootMatches ? { threadRoot: onWire } : {}),
      },
    });
  }
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
