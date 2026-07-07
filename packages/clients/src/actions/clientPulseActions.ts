'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { getContactAvatarUrlsBatchAsync } from '../lib/documentsHelpers';
import type {
  ClientAttentionFlag,
  ClientAttentionSeverity,
  ClientPulse,
  ClientPulseDocuments,
  ClientPulseInstallBase,
  ClientPulseMoney,
  ClientPulseNotes,
  ClientPulsePeople,
  ClientPulseRecord,
  ClientPulseService,
  ClientPulseTicketSla,
  ClientPulseWarranty,
  ClientPulseWip,
} from '../lib/commandCenterTypes';

type ClientPulseLocations = ClientPulse['locations'];

const DAY_MS = 86_400_000;
const DRAFT_INVOICE_PREVIEW_LIMIT = 5;
const NOTE_PREVIEW_LINE_LIMIT = 2;
const COMPLETED_PAYMENT_STATUS = 'completed';
const DELIVERED_STOCK_UNIT_STATUS = 'delivered';
const TERMINAL_RMA_STATUSES = ['closed'];
const TERMINAL_SALES_ORDER_STATUSES = ['fulfilled', 'invoiced', 'closed', 'cancelled'];

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function daysSince(value: unknown, nowMs: number): number | null {
  const iso = toIsoString(value);
  if (!iso) return null;
  return Math.floor((nowMs - new Date(iso).getTime()) / DAY_MS);
}

function startOfUtcDayMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysPastDue(value: unknown, nowMs: number): number {
  const iso = toIsoString(value);
  if (!iso) return 0;
  const due = startOfUtcDayMs(new Date(iso));
  const today = startOfUtcDayMs(new Date(nowMs));
  return Math.floor((today - due) / DAY_MS);
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

function timestampMs(value: unknown): number | null {
  const iso = toIsoString(value);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatUserName(row: { first_name?: string | null; last_name?: string | null; username?: string | null; email?: string | null }): string | null {
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return fullName || row.username || row.email || null;
}

function calculateTicketSla(
  ticket: {
    sla_policy_id?: string | null;
    sla_started_at?: unknown;
    sla_paused_at?: unknown;
    sla_response_at?: unknown;
    sla_response_due_at?: unknown;
    sla_resolution_at?: unknown;
    sla_resolution_due_at?: unknown;
    entered_at?: unknown;
  },
  nowMs: number,
): ClientPulseTicketSla | null {
  if (!ticket.sla_policy_id) return null;

  const isPaused = ticket.sla_paused_at !== null && ticket.sla_paused_at !== undefined;
  const pendingResponse = !ticket.sla_response_at && ticket.sla_response_due_at;
  const pendingResolution = !ticket.sla_resolution_at && ticket.sla_resolution_due_at;
  const dueAt = pendingResponse ? ticket.sla_response_due_at : pendingResolution ? ticket.sla_resolution_due_at : null;
  if (!dueAt) return null;

  const dueMs = timestampMs(dueAt);
  if (dueMs == null) return null;

  const remainingMs = dueMs - nowMs;
  const remainingMinutes = Math.round(remainingMs / 60000);

  if (isPaused) {
    return { status: 'paused', remainingMinutes };
  }

  if (remainingMinutes < 0) {
    return {
      status: pendingResponse ? 'response_breached' : 'resolution_breached',
      remainingMinutes,
    };
  }

  const startMs = timestampMs(ticket.sla_started_at) ?? timestampMs(ticket.entered_at);
  const totalMs = startMs == null ? 0 : dueMs - startMs;
  const elapsedPercent = totalMs > 0 ? ((totalMs - remainingMs) / totalMs) * 100 : 0;
  if (elapsedPercent >= 80) {
    return { status: 'at_risk', remainingMinutes };
  }

  return { status: 'on_track', remainingMinutes };
}

function minTimestampValue(values: unknown[]): unknown | null {
  let oldest: unknown | null = null;
  let oldestMs: number | null = null;
  for (const value of values) {
    const ms = timestampMs(value);
    if (ms == null) continue;
    if (oldestMs == null || ms < oldestMs) {
      oldest = value;
      oldestMs = ms;
    }
  }
  return oldest;
}

function combineWarrantyRows(rows: Array<{ tracked_count?: unknown; expired_count?: unknown; expiring_soon_count?: unknown } | null>): ClientPulseWarranty | null {
  const warranty = rows.reduce<ClientPulseWarranty>(
    (acc, row) => ({
      trackedCount: acc.trackedCount + toNumber(row?.tracked_count),
      expiredCount: acc.expiredCount + toNumber(row?.expired_count),
      expiringSoonCount: acc.expiringSoonCount + toNumber(row?.expiring_soon_count),
    }),
    { trackedCount: 0, expiredCount: 0, expiringSoonCount: 0 },
  );

  return warranty.trackedCount > 0 ? warranty : null;
}

function parseClientProperties(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function defaultContactIdFrom(properties: Record<string, unknown>): string | null {
  const value = properties.primary_contact_id;
  return typeof value === 'string' && value ? value : null;
}

function sortAttention(flags: ClientAttentionFlag[]): ClientAttentionFlag[] {
  const severityRank: Record<ClientAttentionSeverity, number> = {
    amber: 0,
    blue: 1,
    gray: 2,
  };

  return flags
    .map((flag, index) => ({ flag, index }))
    .sort((left, right) => {
      const severityDelta = severityRank[left.flag.severity] - severityRank[right.flag.severity];
      if (severityDelta !== 0) return severityDelta;

      const leftScore = left.flag.amountCents ?? left.flag.daysAgo ?? 0;
      const rightScore = right.flag.amountCents ?? right.flag.daysAgo ?? 0;
      if (leftScore !== rightScore) return rightScore - leftScore;

      return left.index - right.index;
    })
    .map(({ flag }) => flag);
}

async function fetchPeople(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  defaultContactId: string | null,
): Promise<ClientPulsePeople> {
  const [countRow, rows] = await Promise.all([
    trx('contacts')
      .where({ tenant, client_id: clientId, is_inactive: false })
      .count<{ count: string }>('contact_name_id as count')
      .first(),
    trx('contacts')
      .where({ tenant, client_id: clientId, is_inactive: false })
      .select('contact_name_id', 'full_name', 'role', 'email')
      .orderByRaw('CASE WHEN contact_name_id = ? THEN 0 ELSE 1 END', [defaultContactId ?? '00000000-0000-0000-0000-000000000000'])
      .orderByRaw('LOWER(full_name) ASC NULLS LAST')
      .limit(3),
  ]);

  // Phones live in contact_phone_numbers; pick each contact's default
  // (falling back to the first by display order).
  const contactIds = rows.map((row: any) => row.contact_name_id);
  const [phoneRows, avatarUrls] = await Promise.all([
    contactIds.length
      ? trx('contact_phone_numbers')
        .where({ tenant })
        .whereIn('contact_name_id', contactIds)
        .select('contact_name_id', 'phone_number', 'is_default', 'display_order')
        .orderBy([
          { column: 'is_default', order: 'desc' },
          { column: 'display_order', order: 'asc' },
        ])
      : Promise.resolve([]),
    contactIds.length
      ? getContactAvatarUrlsBatchAsync(contactIds, tenant)
      : Promise.resolve(new Map<string, string | null>()),
  ]);
  const phoneByContact = new Map<string, string>();
  for (const phoneRow of phoneRows as any[]) {
    if (!phoneByContact.has(phoneRow.contact_name_id)) {
      phoneByContact.set(phoneRow.contact_name_id, phoneRow.phone_number);
    }
  }

  return {
    totalCount: toNumber(countRow?.count),
    top: rows.map((row: any) => ({
      contact_name_id: row.contact_name_id,
      full_name: row.full_name ?? '',
      role: row.role ?? null,
      email: row.email ?? null,
      phone: phoneByContact.get(row.contact_name_id) ?? null,
      is_default: Boolean(defaultContactId && row.contact_name_id === defaultContactId),
      avatarUrl: avatarUrls.get(row.contact_name_id) ?? null,
    })),
  };
}

async function fetchLocations(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<ClientPulseLocations> {
  const rows = await trx('client_locations')
    .where({ tenant, client_id: clientId, is_active: true })
    .select(
      'location_id',
      'location_name',
      'address_line1',
      'city',
      'phone',
      'email',
      'is_default',
      'is_billing_address',
      'is_shipping_address',
    )
    .orderBy('is_default', 'desc')
    .orderBy('location_name', 'asc');

  return rows.map((row: any) => ({
    location_id: row.location_id,
    location_name: row.location_name ?? null,
    address_line1: row.address_line1 ?? null,
    city: row.city ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    is_default: Boolean(row.is_default),
    is_billing: Boolean(row.is_billing_address),
    is_shipping: Boolean(row.is_shipping_address),
  }));
}

/** Plain text of one BlockNote block: inline nodes carry .text; links nest one level. */
function blockNoteBlockText(block: unknown): string {
  const content = (block as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((node: any) => {
      if (typeof node?.text === 'string') return node.text;
      if (Array.isArray(node?.content)) {
        return node.content.map((child: any) => (typeof child?.text === 'string' ? child.text : '')).join('');
      }
      return '';
    })
    .join('')
    .trim();
}

async function fetchNotes(
  trx: Knex.Transaction,
  tenant: string,
  notesDocumentId: string | null,
): Promise<ClientPulseNotes> {
  const empty: ClientPulseNotes = { hasNotes: false, previewLines: [], lastEditedAt: null };
  if (!notesDocumentId) return empty;

  const contentRow = await trx('document_block_content')
    .where({ tenant, document_id: notesDocumentId })
    .select('block_data', 'updated_at')
    .first();
  if (!contentRow) return empty;

  let blocks: unknown = contentRow.block_data;
  if (typeof blocks === 'string') {
    try {
      blocks = JSON.parse(blocks);
    } catch {
      return empty;
    }
  }
  if (!Array.isArray(blocks)) return empty;

  const previewLines: string[] = [];
  let hasNotes = false;
  for (const block of blocks) {
    const text = blockNoteBlockText(block);
    if (!text) continue;
    hasNotes = true;
    if (previewLines.length < NOTE_PREVIEW_LINE_LIMIT) previewLines.push(text);
    else break;
  }

  // A saved-but-blank doc reads as "no notes" — an empty preview with a
  // timestamp would imply content that isn't there (D6).
  if (!hasNotes) return empty;

  return {
    hasNotes,
    previewLines,
    lastEditedAt: toIsoString(contentRow.updated_at),
  };
}

async function fetchRecord(
  trx: Knex.Transaction,
  tenant: string,
  clientRow: any,
  defaultContactId: string | null,
): Promise<ClientPulseRecord> {
  const [defaultContact, inboundDomains, taxRegion] = await Promise.all([
    defaultContactId
      ? trx('contacts')
        .where({ tenant, contact_name_id: defaultContactId, client_id: clientRow.client_id })
        .select('full_name')
        .first()
      : Promise.resolve(null),
    trx('client_inbound_email_domains')
      .where({ tenant, client_id: clientRow.client_id })
      .orderBy('domain', 'asc')
      .pluck('domain'),
    trx('client_tax_rates as ctr')
      .join('tax_rates as tr', function joinTaxRates() {
        this.on('ctr.tax_rate_id', '=', 'tr.tax_rate_id').andOn('ctr.tenant', '=', 'tr.tenant');
      })
      .join('tax_regions as treg', function joinTaxRegions() {
        this.on('tr.region_code', '=', 'treg.region_code').andOn('tr.tenant', '=', 'treg.tenant');
      })
      .where({
        'ctr.tenant': tenant,
        'ctr.client_id': clientRow.client_id,
        'ctr.is_default': true,
      })
      .whereNull('ctr.location_id')
      .select('treg.region_name')
      .first(),
  ]);

  return {
    url: clientRow.url ?? null,
    accountManagerName: formatUserName(clientRow),
    defaultContactName: defaultContact?.full_name ?? null,
    inboundDomains: inboundDomains.map((domain) => String(domain)),
    taxRegion: taxRegion?.region_name ?? null,
    clientSince: toIsoString(clientRow.created_at),
    isInactive: Boolean(clientRow.is_inactive),
  };
}

async function fetchService(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  nowMs: number,
): Promise<{ service: ClientPulseService; flags: ClientAttentionFlag[] }> {
  const openRows = await trx('tickets as t')
    .leftJoin('priorities as p', function joinPriorities() {
      this.on('t.priority_id', '=', 'p.priority_id').andOn('t.tenant', '=', 'p.tenant');
    })
    .leftJoin('users as assigned_user', function joinAssignedUser() {
      this.on('t.assigned_to', '=', 'assigned_user.user_id').andOn('t.tenant', '=', 'assigned_user.tenant');
    })
    .where({ 't.tenant': tenant, 't.client_id': clientId, 't.is_closed': false })
    .select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.entered_at',
      't.due_date',
      't.assigned_to',
      't.sla_policy_id',
      't.sla_started_at',
      't.sla_paused_at',
      't.sla_response_at',
      't.sla_response_due_at',
      't.sla_resolution_at',
      't.sla_resolution_due_at',
      'p.priority_name',
      'p.color as priority_color',
      'p.order_number as priority_order',
      'assigned_user.first_name as assigned_first_name',
      'assigned_user.last_name as assigned_last_name',
      'assigned_user.username as assigned_username',
      'assigned_user.email as assigned_email',
    );

  const overdueRows = openRows.filter((row: any) => row.due_date && new Date(row.due_date).getTime() < nowMs);
  const oldestOpen = openRows.reduce<unknown | null>((oldest, row: any) => {
    if (!row.entered_at) return oldest;
    if (!oldest) return row.entered_at;
    return new Date(row.entered_at).getTime() < new Date(oldest as any).getTime() ? row.entered_at : oldest;
  }, null);
  const openRowsWithSla = openRows.map((row: any) => ({ row, sla: calculateTicketSla(row, nowMs) }));
  const slaByTicketId = new Map(openRowsWithSla.map(({ row, sla }) => [row.ticket_id, sla]));
  const unassignedRows = openRows.filter((row: any) => row.assigned_to == null);

  const topOpen = [...openRows]
    .sort((left: any, right: any) => {
      const leftPriority = left.priority_order == null ? Number.MIN_SAFE_INTEGER : Number(left.priority_order);
      const rightPriority = right.priority_order == null ? Number.MIN_SAFE_INTEGER : Number(right.priority_order);
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return new Date(left.entered_at ?? 0).getTime() - new Date(right.entered_at ?? 0).getTime();
    })
    .slice(0, 3)
    .map((row: any) => ({
      ticket_id: row.ticket_id,
      ticket_number: String(row.ticket_number ?? ''),
      title: row.title ?? '',
      priority_name: row.priority_name ?? null,
      priority_color: row.priority_color ?? null,
      entered_at: toIsoString(row.entered_at) ?? new Date(0).toISOString(),
      is_overdue: Boolean(row.due_date && new Date(row.due_date).getTime() < nowMs),
      assigned_to_name: formatUserName({
        first_name: row.assigned_first_name,
        last_name: row.assigned_last_name,
        username: row.assigned_username,
        email: row.assigned_email,
      }),
      sla: slaByTicketId.get(row.ticket_id) ?? null,
    }));

  const flags: ClientAttentionFlag[] = [];
  if (overdueRows.length > 0) {
    const mostOverdue = [...overdueRows].sort((left: any, right: any) =>
      new Date(left.due_date).getTime() - new Date(right.due_date).getTime()
    )[0];
    flags.push({
      kind: 'ticket_overdue',
      severity: 'blue',
      count: overdueRows.length,
      refType: 'ticket',
      refId: mostOverdue.ticket_id,
      refLabel: `#${mostOverdue.ticket_number}`,
      daysAgo: daysSince(mostOverdue.due_date, nowMs),
    });
  }

  const breachedSlaRows = openRowsWithSla.filter(({ sla }) =>
    sla?.status === 'response_breached' || sla?.status === 'resolution_breached'
  );
  if (breachedSlaRows.length > 0) {
    const longestBreached = [...breachedSlaRows].sort((left, right) =>
      toNumber(left.sla?.remainingMinutes) - toNumber(right.sla?.remainingMinutes)
    )[0];
    const breachedDueAt = longestBreached.sla?.status === 'response_breached'
      ? longestBreached.row.sla_response_due_at
      : longestBreached.row.sla_resolution_due_at;
    flags.push({
      kind: 'sla_breached',
      severity: 'amber',
      count: breachedSlaRows.length,
      refType: 'ticket',
      refId: longestBreached.row.ticket_id,
      refLabel: `#${longestBreached.row.ticket_number}`,
      daysAgo: Math.max(0, daysSince(breachedDueAt, nowMs) ?? 0),
    });
  }

  const atRiskSlaRows = openRowsWithSla.filter(({ sla }) => sla?.status === 'at_risk');
  if (atRiskSlaRows.length > 0) {
    const closestDue = [...atRiskSlaRows].sort((left, right) =>
      toNumber(left.sla?.remainingMinutes) - toNumber(right.sla?.remainingMinutes)
    )[0];
    flags.push({
      kind: 'sla_at_risk',
      severity: 'blue',
      count: atRiskSlaRows.length,
      refType: 'ticket',
      refId: closestDue.row.ticket_id,
      refLabel: `#${closestDue.row.ticket_number}`,
    });
  }

  if (unassignedRows.length > 0) {
    const oldestUnassigned = [...unassignedRows].sort((left: any, right: any) =>
      new Date(left.entered_at ?? 0).getTime() - new Date(right.entered_at ?? 0).getTime()
    )[0];
    flags.push({
      kind: 'ticket_unassigned',
      severity: 'blue',
      count: unassignedRows.length,
      refType: 'ticket',
      refId: oldestUnassigned.ticket_id,
      refLabel: `#${oldestUnassigned.ticket_number}`,
      daysAgo: daysSince(oldestUnassigned.entered_at, nowMs),
    });
  }

  const latestComments = trx('comments as c')
    .where('c.tenant', tenant)
    .select(
      'c.tenant',
      'c.ticket_id',
      'c.author_type',
      'c.created_at',
      trx.raw('ROW_NUMBER() OVER (PARTITION BY c.tenant, c.ticket_id ORDER BY c.created_at DESC, c.comment_id DESC) as rn'),
    )
    .as('lc');

  const waitingRows = await trx.from(latestComments)
    .join('tickets as t', function joinTickets() {
      this.on('lc.ticket_id', '=', 't.ticket_id').andOn('lc.tenant', '=', 't.tenant');
    })
    .where({ 't.tenant': tenant, 't.client_id': clientId, 't.is_closed': false })
    .andWhere('lc.rn', 1)
    .andWhere('lc.author_type', 'client')
    .select('t.ticket_id', 't.ticket_number', 'lc.created_at')
    .orderBy('lc.created_at', 'asc');

  if (waitingRows.length > 0) {
    const longestWaiting = waitingRows[0] as any;
    flags.push({
      kind: 'client_waiting',
      severity: 'blue',
      count: waitingRows.length,
      refType: 'ticket',
      refId: longestWaiting.ticket_id,
      refLabel: `#${longestWaiting.ticket_number}`,
      daysAgo: daysSince(longestWaiting.created_at, nowMs),
    });
  }

  return {
    service: {
      openCount: openRows.length,
      oldestOpenDays: daysSince(oldestOpen, nowMs),
      overdueCount: overdueRows.length,
      unassignedCount: unassignedRows.length,
      topOpen,
    },
    flags,
  };
}

async function fetchMoney(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  nowMs: number,
): Promise<{ money: ClientPulseMoney; flags: ClientAttentionFlag[] }> {
  const completedPayments = trx('invoice_payments')
    .where({ tenant, status: COMPLETED_PAYMENT_STATUS })
    .groupBy('invoice_id')
    .select('invoice_id')
    .sum({ paid_amount: 'amount' })
    .as('ip');

  const [invoiceRows, draftRows, draftAggRow, contractCountRow, currencyRow, timeWipRow, ticketMaterialWipRow, projectMaterialWipRow] = await Promise.all([
    trx('invoices as i')
      .leftJoin(completedPayments, 'ip.invoice_id', 'i.invoice_id')
      .where({ 'i.tenant': tenant, 'i.client_id': clientId })
      .andWhere(function finalizedPredicate() {
        this.whereNotNull('i.finalized_at').orWhere('i.status', '!=', 'draft');
      })
      .andWhere(function nonPrepaymentPredicate() {
        this.whereNull('i.is_prepayment').orWhere('i.is_prepayment', false);
      })
      .select(
        'i.invoice_id',
        'i.invoice_number',
        'i.due_date',
        'i.total_amount',
        'i.credit_applied',
        'i.currency_code',
        'ip.paid_amount',
      ),
    trx('invoices')
      .where({ tenant, client_id: clientId, status: 'draft' })
      .whereNull('finalized_at')
      .select('invoice_id', 'invoice_number', 'total_amount', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(DRAFT_INVOICE_PREVIEW_LIMIT),
    // Full aggregate — the preview above is capped, but the flag and the
    // "+N more" line must report the true count and total.
    trx('invoices')
      .where({ tenant, client_id: clientId, status: 'draft' })
      .whereNull('finalized_at')
      .count<{ count: string }>('invoice_id as count')
      .sum({ total: 'total_amount' })
      .first(),
    trx('contracts')
      .where({ tenant, owner_client_id: clientId, status: 'active' })
      .count<{ count: string }>('contract_id as count')
      .first(),
    trx('invoices')
      .where({ tenant, client_id: clientId })
      .whereNotNull('currency_code')
      .select('currency_code')
      .orderBy('created_at', 'desc')
      .first(),
    trx('time_entries as te')
      .leftJoin('tickets as wt', function joinWipTickets() {
        this.on('te.work_item_id', '=', 'wt.ticket_id').andOn('te.tenant', '=', 'wt.tenant');
      })
      .leftJoin('project_tasks as pt', function joinWipProjectTasks() {
        this.on('te.work_item_id', '=', 'pt.task_id').andOn('te.tenant', '=', 'pt.tenant');
      })
      .leftJoin('project_phases as pp', function joinWipProjectPhases() {
        this.on('pt.phase_id', '=', 'pp.phase_id').andOn('pt.tenant', '=', 'pp.tenant');
      })
      .leftJoin('projects as pr', function joinWipProjects() {
        this.on('pp.project_id', '=', 'pr.project_id').andOn('pp.tenant', '=', 'pr.tenant');
      })
      .where({ 'te.tenant': tenant, 'te.invoiced': false })
      .where('te.billable_duration', '>', 0)
      .andWhere(function matchWipClient() {
        this.where(function matchTicketTime() {
          this.where('te.work_item_type', 'ticket').where('wt.client_id', clientId);
        }).orWhere(function matchProjectTaskTime() {
          this.where('te.work_item_type', 'project_task').where('pr.client_id', clientId);
        });
      })
      .select(
        trx.raw('COALESCE(SUM(te.billable_duration), 0) as total_minutes'),
        trx.raw('COUNT(te.entry_id)::int as entry_count'),
        trx.raw('MIN(te.work_date) as oldest_work_date'),
      )
      .first(),
    trx('ticket_materials')
      .where({ tenant, client_id: clientId, is_billed: false })
      .select(
        trx.raw('COALESCE(SUM(ROUND(quantity::numeric * rate::numeric)), 0) as total_cents'),
        trx.raw('COUNT(ticket_material_id)::int as material_count'),
        trx.raw('MIN(created_at) as oldest_created_at'),
      )
      .first(),
    trx('project_materials')
      .where({ tenant, client_id: clientId, is_billed: false })
      .select(
        trx.raw('COALESCE(SUM(ROUND(quantity::numeric * rate::numeric)), 0) as total_cents'),
        trx.raw('COUNT(project_material_id)::int as material_count'),
        trx.raw('MIN(created_at) as oldest_created_at'),
      )
      .first(),
  ]);

  const aging = {
    currentCents: 0,
    d30Cents: 0,
    d60Cents: 0,
    d90PlusCents: 0,
  };
  let outstandingTotalCents = 0;
  let unpaidInvoiceCount = 0;

  for (const row of invoiceRows as any[]) {
    const outstanding = toNumber(row.total_amount) - toNumber(row.credit_applied) - toNumber(row.paid_amount);
    if (outstanding <= 0) continue;

    outstandingTotalCents += outstanding;
    unpaidInvoiceCount += 1;

    const pastDueDays = daysPastDue(row.due_date, nowMs);
    if (!row.due_date || pastDueDays <= 0) {
      aging.currentCents += outstanding;
    } else if (pastDueDays <= 30) {
      aging.d30Cents += outstanding;
    } else if (pastDueDays <= 60) {
      aging.d60Cents += outstanding;
    } else {
      aging.d90PlusCents += outstanding;
    }
  }

  const draftInvoices = (draftRows as any[]).map((row) => ({
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number ?? null,
    totalCents: toNumber(row.total_amount),
    created_at: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  }));

  const draftInvoiceCount = toNumber((draftAggRow as any)?.count);
  const draftTotalCents = toNumber((draftAggRow as any)?.total);
  const totalWipMinutes = toNumber((timeWipRow as any)?.total_minutes);
  const unbilledEntryCount = toNumber((timeWipRow as any)?.entry_count);
  const unbilledMaterialsCents =
    toNumber((ticketMaterialWipRow as any)?.total_cents) + toNumber((projectMaterialWipRow as any)?.total_cents);
  const unbilledMaterialCount =
    toNumber((ticketMaterialWipRow as any)?.material_count) + toNumber((projectMaterialWipRow as any)?.material_count);
  const oldestUnbilledAt = minTimestampValue([
    (timeWipRow as any)?.oldest_work_date,
    (ticketMaterialWipRow as any)?.oldest_created_at,
    (projectMaterialWipRow as any)?.oldest_created_at,
  ]);
  const wip: ClientPulseWip = {
    unbilledHours: Math.round((totalWipMinutes / 60) * 10) / 10,
    unbilledEntryCount,
    unbilledMaterialsCents,
    unbilledMaterialCount,
    oldestUnbilledDays: daysSince(oldestUnbilledAt, nowMs),
  };

  const flags: ClientAttentionFlag[] = [];
  if (draftInvoiceCount > 0 && draftInvoices.length > 0) {
    const newest = draftInvoices[0];
    flags.push({
      kind: 'draft_invoices',
      severity: 'amber',
      count: draftInvoiceCount,
      amountCents: draftTotalCents,
      refType: 'invoice',
      refId: newest.invoice_id,
      refLabel: newest.invoice_number,
    });
  }

  if (wip.oldestUnbilledDays != null && wip.oldestUnbilledDays > 14) {
    flags.push({
      kind: 'wip_aging',
      severity: 'amber',
      count: unbilledEntryCount + unbilledMaterialCount,
      ...(unbilledMaterialsCents > 0 ? { amountCents: unbilledMaterialsCents } : {}),
      daysAgo: wip.oldestUnbilledDays,
    });
  }

  return {
    money: {
      aging,
      outstandingTotalCents,
      unpaidInvoiceCount,
      draftInvoices,
      draftInvoiceCount,
      activeContractCount: toNumber(contractCountRow?.count),
      currencyCode: (currencyRow as any)?.currency_code ?? 'USD',
      wip,
    },
    flags,
  };
}

async function fetchInstallBase(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  canReadAssets: boolean,
  nowMs: number,
): Promise<{ installBase: ClientPulseInstallBase; flags: ClientAttentionFlag[] }> {
  const now = new Date(nowMs);
  const warrantySoon = new Date(nowMs + 90 * DAY_MS);
  const [soldCountRow, recentRows, rmaRows, assetCountRow, partialSoRows, unitWarrantyRow, assetWarrantyRow] = await Promise.all([
    trx('stock_units')
      .where({ tenant, client_id: clientId, status: DELIVERED_STOCK_UNIT_STATUS })
      .count<{ count: string }>('unit_id as count')
      .first(),
    trx('stock_units as u')
      .join('service_catalog as sc', function joinServiceCatalog() {
        this.on('sc.service_id', '=', 'u.service_id').andOn('sc.tenant', '=', 'u.tenant');
      })
      .where({ 'u.tenant': tenant, 'u.client_id': clientId, 'u.status': DELIVERED_STOCK_UNIT_STATUS })
      .select(
        'u.unit_id',
        'sc.service_name as product_name',
        'u.serial_number',
        'u.status',
        'u.delivered_at',
        'u.asset_id',
      )
      .orderByRaw('u.delivered_at DESC NULLS LAST')
      .limit(3),
    trx('rma_cases')
      .where({ tenant, client_id: clientId })
      .whereNotIn('status', TERMINAL_RMA_STATUSES)
      .select('rma_id', 'rma_reference', 'status', 'opened_at')
      .orderBy('opened_at', 'asc'),
    canReadAssets
      ? trx('assets')
        .where({ tenant, client_id: clientId })
        .count<{ count: string }>('asset_id as count')
        .first()
      : Promise.resolve(null),
    trx('sales_orders as so')
      .join('sales_order_lines as sol', function joinLines() {
        this.on('sol.so_id', '=', 'so.so_id').andOn('sol.tenant', '=', 'so.tenant');
      })
      .where({ 'so.tenant': tenant, 'so.client_id': clientId })
      .whereNotIn('so.status', TERMINAL_SALES_ORDER_STATUSES)
      .groupBy('so.so_id', 'so.so_number', 'so.created_at')
      .select(
        'so.so_id',
        'so.so_number',
        'so.created_at',
        trx.raw('COUNT(sol.so_line_id)::int as lines_total'),
        trx.raw('COUNT(*) FILTER (WHERE sol.quantity_fulfilled >= sol.quantity_ordered)::int as lines_fulfilled'),
      )
      .havingRaw('COUNT(*) FILTER (WHERE sol.quantity_fulfilled >= sol.quantity_ordered) > 0')
      .havingRaw('COUNT(*) FILTER (WHERE sol.quantity_fulfilled >= sol.quantity_ordered) < COUNT(sol.so_line_id)')
      .orderBy('so.created_at', 'desc')
      .limit(3),
    trx('stock_units')
      .where({ tenant, client_id: clientId, status: DELIVERED_STOCK_UNIT_STATUS })
      .whereNotNull('warranty_expires_at')
      .select(
        trx.raw('COUNT(unit_id)::int as tracked_count'),
        trx.raw('COUNT(*) FILTER (WHERE warranty_expires_at < ?)::int as expired_count', [now]),
        trx.raw('COUNT(*) FILTER (WHERE warranty_expires_at >= ? AND warranty_expires_at < ?)::int as expiring_soon_count', [now, warrantySoon]),
      )
      .first(),
    canReadAssets
      ? trx('assets')
        .where({ tenant, client_id: clientId })
        .whereNotNull('warranty_end_date')
        .select(
          trx.raw('COUNT(asset_id)::int as tracked_count'),
          trx.raw('COUNT(*) FILTER (WHERE warranty_end_date < ?)::int as expired_count', [now]),
          trx.raw('COUNT(*) FILTER (WHERE warranty_end_date >= ? AND warranty_end_date < ?)::int as expiring_soon_count', [now, warrantySoon]),
        )
        .first()
      : Promise.resolve(null),
  ]);

  const flags: ClientAttentionFlag[] = [];
  for (const row of partialSoRows as any[]) {
    flags.push({
      kind: 'so_partial',
      severity: 'gray',
      count: 1,
      refType: 'sales_order',
      refId: row.so_id,
      refLabel: row.so_number,
      linesFulfilled: toNumber(row.lines_fulfilled),
      linesTotal: toNumber(row.lines_total),
    });
  }

  if ((rmaRows as any[]).length > 0) {
    const oldest = (rmaRows as any[])[0];
    flags.push({
      kind: 'rma_open',
      severity: 'gray',
      count: (rmaRows as any[]).length,
      refType: 'rma',
      refId: oldest.rma_id,
      refLabel: oldest.rma_reference ?? null,
      daysAgo: daysSince(oldest.opened_at, nowMs),
    });
  }

  return {
    installBase: {
      managedAssetCount: canReadAssets ? toNumber((assetCountRow as any)?.count) : null,
      soldUnitCount: toNumber(soldCountRow?.count),
      openRmaCount: (rmaRows as any[]).length,
      recentUnits: (recentRows as any[]).map((row) => ({
        unit_id: row.unit_id,
        product_name: row.product_name ?? '',
        serial_number: row.serial_number ?? null,
        status: row.status,
        delivered_at: toIsoString(row.delivered_at),
        asset_id: row.asset_id ?? null,
      })),
      warranty: combineWarrantyRows([unitWarrantyRow as any, assetWarrantyRow as any]),
    },
    flags,
  };
}

async function fetchDocuments(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<ClientPulseDocuments> {
  const baseQuery = () =>
    trx('documents as d')
      .join('document_associations as da', function joinDocumentAssociations() {
        this.on('d.document_id', '=', 'da.document_id').andOn('d.tenant', '=', 'da.tenant');
      })
      .where({
        'd.tenant': tenant,
        'da.tenant': tenant,
        'da.entity_id': clientId,
        'da.entity_type': 'client',
      });

  const [countRow, recentRows] = await Promise.all([
    baseQuery()
      .countDistinct<{ count: string }>('d.document_id as count')
      .first(),
    baseQuery()
      .distinct('d.document_id', 'd.document_name', 'd.updated_at')
      .orderBy('d.updated_at', 'desc')
      .limit(3),
  ]);

  return {
    totalCount: toNumber(countRow?.count),
    recent: (recentRows as any[]).map((row) => ({
      document_id: row.document_id,
      document_name: row.document_name,
      updated_at: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
    })),
  };
}

/**
 * Aggregated, RBAC-shaped snapshot powering the client command center.
 * Contract: ee/docs/plans/2026-07-02-client-command-center/PRD.md (D5/D6/D8).
 *
 * Base gate client:read (throws). Optional sections included only when the
 * caller holds the matching permission (see ClientPulsePermissions).
 */
export const getClientPulse = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientPulse> => {
  if (!(await hasPermission(user, 'client', 'read'))) {
    throw new Error('Permission denied: cannot read client');
  }

  const [canReadTickets, canReadBilling, canReadInventory, canReadAssets, canReadDocuments] = await Promise.all([
    hasPermission(user, 'ticket', 'read'),
    hasPermission(user, 'billing', 'read'),
    hasPermission(user, 'inventory', 'read'),
    hasPermission(user, 'asset', 'read'),
    hasPermission(user, 'document', 'read'),
  ]);

  const permissions = {
    tickets: canReadTickets,
    billing: canReadBilling,
    inventory: canReadInventory,
    assets: canReadAssets,
    documents: canReadDocuments,
  };

  const nowMs = Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const clientRow = await trx('clients as c')
      .leftJoin('users as u', function joinAccountManager() {
        this.on('c.account_manager_id', '=', 'u.user_id').andOn('c.tenant', '=', 'u.tenant');
      })
      .where({ 'c.tenant': tenant, 'c.client_id': clientId })
      .select(
        'c.client_id',
        'c.created_at',
        'c.url',
        'c.account_manager_id',
        'c.is_inactive',
        'c.properties',
        'c.notes_document_id',
        'u.first_name',
        'u.last_name',
        'u.username',
        'u.email',
      )
      .first();

    if (!clientRow) {
      throw new Error('Client not found');
    }

    const clientProperties = parseClientProperties(clientRow.properties);
    const defaultContactId = defaultContactIdFrom(clientProperties);

    const [
      people,
      locations,
      record,
      notes,
      serviceResult,
      moneyResult,
      installBaseResult,
      documents,
    ] = await Promise.all([
      fetchPeople(trx, tenant, clientId, defaultContactId),
      fetchLocations(trx, tenant, clientId),
      fetchRecord(trx, tenant, clientRow, defaultContactId),
      fetchNotes(trx, tenant, clientRow.notes_document_id ?? null),
      canReadTickets ? fetchService(trx, tenant, clientId, nowMs) : Promise.resolve(null),
      canReadBilling ? fetchMoney(trx, tenant, clientId, nowMs) : Promise.resolve(null),
      canReadInventory ? fetchInstallBase(trx, tenant, clientId, canReadAssets, nowMs) : Promise.resolve(null),
      canReadDocuments ? fetchDocuments(trx, tenant, clientId) : Promise.resolve(null),
    ]);

    const attention = sortAttention([
      ...(serviceResult?.flags ?? []),
      ...(moneyResult?.flags ?? []),
      ...(installBaseResult?.flags ?? []),
    ]);

    return {
      generatedAt,
      permissions,
      attention,
      ...(serviceResult ? { service: serviceResult.service } : {}),
      ...(moneyResult ? { money: moneyResult.money } : {}),
      ...(installBaseResult ? { installBase: installBaseResult.installBase } : {}),
      people,
      locations,
      ...(documents ? { documents } : {}),
      notes,
      record,
    };
  });
});
