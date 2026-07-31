'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type {
  ClientTimelineEvent,
  ClientTimelineEventType,
  ClientTimelinePage,
  ClientTimelineQuery,
} from '../lib/commandCenterTypes';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type CursorParts = {
  occurredAt: string;
  id: string;
};

type TimelineRow = Record<string, unknown>;
type ClientTimelineActionError = ActionMessageError | ActionPermissionError;

function clientTimelineActionErrorFrom(error: unknown): ClientTimelineActionError | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (error.message.includes('Permission denied')) {
    return permissionError(error.message);
  }
  if (error.message === 'Invalid client timeline cursor') {
    return actionError('Invalid client timeline cursor');
  }
  return null;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit as number)));
}

function decodeCursor(cursor: string | null | undefined): CursorParts | null {
  if (!cursor) {
    return null;
  }

  const decoded = Buffer.from(cursor, 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf('|');

  if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) {
    throw new Error('Invalid client timeline cursor');
  }

  const timestamp = new Date(decoded.slice(0, separatorIndex));
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Invalid client timeline cursor');
  }

  const occurredAt = timestamp.toISOString();
  const id = decoded.slice(separatorIndex + 1);

  return { occurredAt, id };
}

function encodeCursor(event: ClientTimelineEvent): string {
  return Buffer.from(`${event.occurredAt}|${event.id}`, 'utf8').toString('base64');
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value as string | number).toISOString();
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value);
    }
  }

  return '';
}

function invoiceStatus(row: TimelineRow): string | null {
  const status = row.status === null || row.status === undefined ? null : String(row.status);
  if (row.finalized_at && status === 'draft') {
    return 'finalized';
  }

  return status;
}

function applyCursor(
  query: Knex.QueryBuilder,
  timestampColumn: string,
  idExpression: string,
  cursor: CursorParts | null
): Knex.QueryBuilder {
  if (!cursor) {
    return query;
  }

  return query.andWhere(function () {
    this.where(timestampColumn, '<', cursor.occurredAt)
      .orWhere(function () {
        this.where(timestampColumn, '=', cursor.occurredAt)
          .andWhereRaw(`${idExpression} < ?`, [cursor.id]);
      });
  });
}

function finishSourceQuery(
  query: Knex.QueryBuilder,
  timestampColumn: string,
  idExpression: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Knex.QueryBuilder {
  return applyCursor(query, timestampColumn, idExpression, cursor)
    .orderBy(timestampColumn, 'desc')
    .orderByRaw(`${idExpression} DESC`)
    .limit(sourceLimit);
}

function typeAllowed(allowedTypes: Set<ClientTimelineEventType> | null, type: ClientTimelineEventType): boolean {
  return allowedTypes === null || allowedTypes.has(type);
}

async function listTicketOpenedEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('tickets:', t.ticket_id::text)";
  const rows = await finishSourceQuery(
    trx('tickets as t')
      .where({ 't.tenant': tenant, 't.client_id': clientId })
      .whereNotNull('t.entered_at')
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.is_closed',
        't.entered_at'
      ),
    't.entered_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const ticketId = String(row.ticket_id);
    const ticketNumber = firstNonEmpty(row.ticket_number, shortId(ticketId));

    return {
      id: `tickets:${ticketId}`,
      type: 'ticket_opened',
      occurredAt: toIsoString(row.entered_at),
      refType: 'ticket',
      refId: ticketId,
      refLabel: `#${ticketNumber}`,
      summary: firstNonEmpty(row.title, ticketNumber),
      status: row.is_closed ? 'closed' : 'open',
    };
  });
}

async function listTicketClosedEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('tickets:', t.ticket_id::text, ':closed')";
  const rows = await finishSourceQuery(
    trx('tickets as t')
      .where({ 't.tenant': tenant, 't.client_id': clientId })
      .whereNotNull('t.closed_at')
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.closed_at'
      ),
    't.closed_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const ticketId = String(row.ticket_id);
    const ticketNumber = firstNonEmpty(row.ticket_number, shortId(ticketId));

    return {
      id: `tickets:${ticketId}:closed`,
      type: 'ticket_closed',
      occurredAt: toIsoString(row.closed_at),
      refType: 'ticket',
      refId: ticketId,
      refLabel: `#${ticketNumber}`,
      summary: firstNonEmpty(row.title, ticketNumber),
      status: 'closed',
    };
  });
}

async function listMaterialAddedEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('ticket_materials:', tm.ticket_material_id::text)";
  const rows = await finishSourceQuery(
    trx('ticket_materials as tm')
      .join('tickets as t', function () {
        this.on('t.ticket_id', '=', 'tm.ticket_id')
          .andOn('t.tenant', '=', 'tm.tenant');
      })
      .leftJoin('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'tm.service_id')
          .andOn('sc.tenant', '=', 'tm.tenant');
      })
      .where({ 'tm.tenant': tenant, 'tm.client_id': clientId })
      .whereNotNull('tm.created_at')
      .select(
        'tm.ticket_material_id',
        'tm.ticket_id',
        'tm.quantity',
        'tm.description',
        'tm.created_at',
        't.ticket_number',
        'sc.service_name'
      ),
    'tm.created_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const materialId = String(row.ticket_material_id);
    const ticketId = String(row.ticket_id);
    const ticketNumber = firstNonEmpty(row.ticket_number, shortId(ticketId));
    const serviceName = firstNonEmpty(row.service_name, row.description, materialId);
    const quantity = Number(row.quantity ?? 1);

    return {
      id: `ticket_materials:${materialId}`,
      type: 'material_added',
      occurredAt: toIsoString(row.created_at),
      refType: 'ticket',
      refId: ticketId,
      refLabel: `#${ticketNumber}`,
      summary: quantity > 1 ? `${serviceName} x ${quantity}` : serviceName,
      amountCents: null,
    };
  });
}

async function listInvoiceCreatedEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('invoices:', i.invoice_id::text)";
  const rows = await finishSourceQuery(
    trx('invoices as i')
      .where({ 'i.tenant': tenant, 'i.client_id': clientId })
      .whereNotNull('i.created_at')
      // W5/D-t1: a "drafted" event for an invoice that is STILL a draft
      // duplicates the money card and the attention flag — suppress it until
      // the invoice leaves draft (then its creation is history worth keeping).
      .andWhere(function notStillDraft() {
        this.whereNotNull('i.finalized_at').orWhere('i.status', '!=', 'draft');
      })
      .select(
        'i.invoice_id',
        'i.invoice_number',
        'i.total_amount',
        'i.status',
        'i.finalized_at',
        'i.created_at'
      ),
    'i.created_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const invoiceId = String(row.invoice_id);
    const label = firstNonEmpty(row.invoice_number, shortId(invoiceId));

    return {
      id: `invoices:${invoiceId}`,
      type: 'invoice_created',
      occurredAt: toIsoString(row.created_at),
      refType: 'invoice',
      refId: invoiceId,
      refLabel: label,
      summary: label,
      amountCents: Number(row.total_amount ?? 0),
      status: invoiceStatus(row),
    };
  });
}

async function listInvoiceFinalizedEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('invoices:', i.invoice_id::text, ':finalized')";
  const rows = await finishSourceQuery(
    trx('invoices as i')
      .where({ 'i.tenant': tenant, 'i.client_id': clientId })
      .whereNotNull('i.finalized_at')
      .select(
        'i.invoice_id',
        'i.invoice_number',
        'i.total_amount',
        'i.status',
        'i.finalized_at'
      ),
    'i.finalized_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const invoiceId = String(row.invoice_id);
    const label = firstNonEmpty(row.invoice_number, shortId(invoiceId));

    return {
      id: `invoices:${invoiceId}:finalized`,
      type: 'invoice_finalized',
      occurredAt: toIsoString(row.finalized_at),
      refType: 'invoice',
      refId: invoiceId,
      refLabel: label,
      summary: label,
      amountCents: Number(row.total_amount ?? 0),
      status: invoiceStatus(row),
    };
  });
}

async function listUnitDeliveredEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('stock_units:', u.unit_id::text)";
  const rows = await finishSourceQuery(
    trx('stock_units as u')
      .join('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'u.service_id')
          .andOn('sc.tenant', '=', 'u.tenant');
      })
      .where({ 'u.tenant': tenant, 'u.client_id': clientId, 'u.status': 'delivered' })
      .whereNotNull('u.delivered_at')
      .select(
        'u.unit_id',
        'u.serial_number',
        'u.asset_id',
        'u.delivered_at',
        'sc.service_name'
      ),
    'u.delivered_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const unitId = String(row.unit_id);
    const productName = firstNonEmpty(row.service_name, shortId(unitId));

    return {
      id: `stock_units:${unitId}`,
      type: 'unit_delivered',
      occurredAt: toIsoString(row.delivered_at),
      refType: 'stock_unit',
      refId: unitId,
      refLabel: firstNonEmpty(row.serial_number, productName),
      summary: productName,
      status: 'delivered',
      linkedAssetId: row.asset_id === null || row.asset_id === undefined ? null : String(row.asset_id),
    };
  });
}

async function listSalesOrderCreatedEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('sales_orders:', so.so_id::text)";
  const rows = await finishSourceQuery(
    trx('sales_orders as so')
      .where({ 'so.tenant': tenant, 'so.client_id': clientId })
      .whereNotNull('so.created_at')
      .select(
        'so.so_id',
        'so.so_number',
        'so.status',
        'so.created_at'
      ),
    'so.created_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const soId = String(row.so_id);
    const label = firstNonEmpty(row.so_number, shortId(soId));

    return {
      id: `sales_orders:${soId}`,
      type: 'so_created',
      occurredAt: toIsoString(row.created_at),
      refType: 'sales_order',
      refId: soId,
      refLabel: label,
      summary: label,
      status: row.status === null || row.status === undefined ? null : String(row.status),
    };
  });
}

async function listRmaOpenedEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('rma_cases:', r.rma_id::text)";
  const rows = await finishSourceQuery(
    trx('rma_cases as r')
      .leftJoin('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'r.service_id')
          .andOn('sc.tenant', '=', 'r.tenant');
      })
      .where({ 'r.tenant': tenant, 'r.client_id': clientId })
      .whereNotNull('r.opened_at')
      .select(
        'r.rma_id',
        'r.rma_reference',
        'r.reason',
        'r.status',
        'r.opened_at',
        'sc.service_name'
      ),
    'r.opened_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const rmaId = String(row.rma_id);
    const label = firstNonEmpty(row.rma_reference, shortId(rmaId));

    return {
      id: `rma_cases:${rmaId}`,
      type: 'rma_opened',
      occurredAt: toIsoString(row.opened_at),
      refType: 'rma',
      refId: rmaId,
      refLabel: label,
      summary: firstNonEmpty(row.reason, row.service_name, label),
      status: row.status === null || row.status === undefined ? null : String(row.status),
    };
  });
}

async function listRmaClosedEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('rma_cases:', r.rma_id::text, ':closed')";
  const rows = await finishSourceQuery(
    trx('rma_cases as r')
      .leftJoin('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'r.service_id')
          .andOn('sc.tenant', '=', 'r.tenant');
      })
      .where({ 'r.tenant': tenant, 'r.client_id': clientId })
      .whereNotNull('r.closed_at')
      .select(
        'r.rma_id',
        'r.rma_reference',
        'r.reason',
        'r.status',
        'r.closed_at',
        'sc.service_name'
      ),
    'r.closed_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const rmaId = String(row.rma_id);
    const label = firstNonEmpty(row.rma_reference, shortId(rmaId));

    return {
      id: `rma_cases:${rmaId}:closed`,
      type: 'rma_closed',
      occurredAt: toIsoString(row.closed_at),
      refType: 'rma',
      refId: rmaId,
      refLabel: label,
      summary: firstNonEmpty(row.reason, row.service_name, label),
      status: row.status === null || row.status === undefined ? null : String(row.status),
    };
  });
}

async function listInteractionEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('interactions:', i.interaction_id::text)";
  const rows = await finishSourceQuery(
    trx('interactions as i')
      .leftJoin('interaction_types as it', function () {
        this.on('it.type_id', '=', 'i.type_id')
          .andOn('it.tenant', '=', 'i.tenant');
      })
      .leftJoin('system_interaction_types as sit', function () {
        this.on('sit.type_id', '=', 'i.type_id');
      })
      .where({ 'i.tenant': tenant, 'i.client_id': clientId })
      .whereNotNull('i.interaction_date')
      .select(
        'i.interaction_id',
        'i.title',
        'i.interaction_date',
        trx.raw('COALESCE(it.type_name, sit.type_name) as type_name')
      ),
    'i.interaction_date',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const interactionId = String(row.interaction_id);
    const title = firstNonEmpty(row.title);
    const typeName = firstNonEmpty(row.type_name);
    const summary = title && typeName ? `${typeName}: ${title}` : firstNonEmpty(title, typeName, shortId(interactionId));

    return {
      id: `interactions:${interactionId}`,
      type: 'interaction',
      occurredAt: toIsoString(row.interaction_date),
      refType: 'interaction',
      refId: interactionId,
      refLabel: firstNonEmpty(title, typeName, shortId(interactionId)),
      summary,
    };
  });
}

async function listQuoteActivityEvents(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  cursor: CursorParts | null,
  sourceLimit: number
): Promise<ClientTimelineEvent[]> {
  const idExpression = "concat('quote_activities:', qa.activity_id::text)";
  const rows = await finishSourceQuery(
    trx('quote_activities as qa')
      .join('quotes as q', function () {
        this.on('q.quote_id', '=', 'qa.quote_id')
          .andOn('q.tenant', '=', 'qa.tenant');
      })
      .where({ 'qa.tenant': tenant, 'q.client_id': clientId })
      .whereNotNull('qa.created_at')
      .select(
        'qa.activity_id',
        'qa.quote_id',
        'qa.activity_type',
        'qa.description',
        'qa.created_at',
        'q.quote_number'
      ),
    'qa.created_at',
    idExpression,
    cursor,
    sourceLimit
  );

  return rows.map((row: TimelineRow) => {
    const activityId = String(row.activity_id);
    const quoteId = String(row.quote_id);
    const label = firstNonEmpty(row.quote_number, shortId(quoteId));

    return {
      id: `quote_activities:${activityId}`,
      type: 'quote_activity',
      occurredAt: toIsoString(row.created_at),
      refType: 'quote',
      refId: quoteId,
      refLabel: label,
      summary: firstNonEmpty(row.description, row.activity_type, label),
      status: firstNonEmpty(row.activity_type) || null,
    };
  });
}

/**
 * Unified client timeline: read-time UNION across module tables, cursor-paginated,
 * events filtered by the caller's per-module permissions.
 * Contract: ee/docs/plans/2026-07-02-client-command-center/PRD.md (D5/D9).
 */
export const listClientTimeline = withAuth(async (
  user,
  { tenant },
  clientId: string,
  query?: ClientTimelineQuery
): Promise<ClientTimelinePage | ClientTimelineActionError> => {
  try {
  if (!(await hasPermission(user, 'client', 'read'))) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const limit = normalizeLimit(query?.limit);
  const sourceLimit = limit + 1;
  const cursor = decodeCursor(query?.cursor);
  const allowedTypes = query?.types ? new Set(query.types) : null;

  if (allowedTypes && allowedTypes.size === 0) {
    return { events: [], nextCursor: null };
  }

  const [canReadTickets, canReadBilling, canReadInventory] = await Promise.all([
    hasPermission(user, 'ticket', 'read'),
    hasPermission(user, 'billing', 'read'),
    hasPermission(user, 'inventory', 'read'),
  ]);

  const { knex: db } = await createTenantKnex();
  const events = await withTransaction(db, async (trx: Knex.Transaction) => {
    const sourceQueries: Array<Promise<ClientTimelineEvent[]>> = [];

    if (canReadTickets) {
      if (typeAllowed(allowedTypes, 'ticket_opened')) {
        sourceQueries.push(listTicketOpenedEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
      if (typeAllowed(allowedTypes, 'ticket_closed')) {
        sourceQueries.push(listTicketClosedEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
      if (typeAllowed(allowedTypes, 'material_added')) {
        sourceQueries.push(listMaterialAddedEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
    }

    if (canReadBilling) {
      if (typeAllowed(allowedTypes, 'invoice_created')) {
        sourceQueries.push(listInvoiceCreatedEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
      if (typeAllowed(allowedTypes, 'invoice_finalized')) {
        sourceQueries.push(listInvoiceFinalizedEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
      if (typeAllowed(allowedTypes, 'quote_activity')) {
        sourceQueries.push(listQuoteActivityEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
    }

    if (canReadInventory) {
      if (typeAllowed(allowedTypes, 'unit_delivered')) {
        sourceQueries.push(listUnitDeliveredEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
      if (typeAllowed(allowedTypes, 'so_created')) {
        sourceQueries.push(listSalesOrderCreatedEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
      if (typeAllowed(allowedTypes, 'rma_opened')) {
        sourceQueries.push(listRmaOpenedEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
      if (typeAllowed(allowedTypes, 'rma_closed')) {
        sourceQueries.push(listRmaClosedEvents(trx, tenant, clientId, cursor, sourceLimit));
      }
    }

    if (typeAllowed(allowedTypes, 'interaction')) {
      sourceQueries.push(listInteractionEvents(trx, tenant, clientId, cursor, sourceLimit));
    }

    const sourceEvents = await Promise.all(sourceQueries);
    return sourceEvents.flat();
  });

  // Codepoint comparisons (not localeCompare): host-locale collation must never
  // disagree with the SQL cursor predicate's ordering on same-timestamp rows.
  const sortedEvents = events.sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) {
      return a.occurredAt < b.occurredAt ? 1 : -1;
    }

    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
  const pageEvents = sortedEvents.slice(0, limit);

  return {
    events: pageEvents,
    nextCursor: sortedEvents.length > limit && pageEvents.length > 0
      ? encodeCursor(pageEvents[pageEvents.length - 1])
      : null,
  };
  } catch (error) {
    const expected = clientTimelineActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
