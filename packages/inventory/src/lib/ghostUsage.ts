import type { Knex } from 'knex';
import type {
  GhostClassificationResult,
  GhostClassificationVerdict,
  GhostDisposition,
  GhostTicketInput,
  GhostUsageCandidateRow,
  GhostUsageFilters,
  GhostUsageReportResult,
} from './ghostUsageTypes';

type Db = Knex | Knex.Transaction;
type CountRow = { count?: string | number | bigint };
type RawCandidateRow = Omit<GhostUsageCandidateRow, 'ai_confidence' | 'closed_at'> & {
  ai_confidence: string | number | null;
  closed_at: string | Date | null;
};

const GHOST_CLASSIFICATIONS: GhostClassificationVerdict[] = ['hardware_missing', 'no_hardware', 'unclear'];

function nonEmptyIds(ids: string[] | undefined): string[] {
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.length > 0) : [];
}

function isBareDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function applyClosedDateFilters(
  query: Knex.QueryBuilder,
  filters: GhostUsageFilters,
): Knex.QueryBuilder {
  if (filters.closedFrom) {
    query.andWhere('t.closed_at', '>=', filters.closedFrom);
  }

  if (filters.closedTo) {
    if (isBareDate(filters.closedTo)) {
      query.andWhereRaw("t.closed_at < (?::date + interval '1 day')", [filters.closedTo]);
    } else {
      query.andWhere('t.closed_at', '<=', filters.closedTo);
    }
  }

  return query;
}

function applyHardwareScope(query: Knex.QueryBuilder, filters: GhostUsageFilters): Knex.QueryBuilder {
  const boardIds = nonEmptyIds(filters.boardIds);
  if (boardIds.length > 0) {
    query.andWhere(function () {
      this.whereIn('t.board_id', boardIds);
    });
  }

  const categoryIds = nonEmptyIds(filters.categoryIds);
  if (categoryIds.length > 0) {
    query.andWhere(function () {
      this.whereIn('t.category_id', categoryIds).orWhereIn('t.subcategory_id', categoryIds);
    });
  }

  return query;
}

function applyMaterialPredicate(query: Knex.QueryBuilder, db: Db, exists: boolean): Knex.QueryBuilder {
  const method = exists ? 'whereExists' : 'whereNotExists';
  return query[method](function () {
    this.select(db.raw('1'))
      .from('ticket_materials as tm')
      .whereRaw('tm.tenant = t.tenant')
      .andWhereRaw('tm.ticket_id = t.ticket_id');
  });
}

function applyReviewAbsentPredicate(query: Knex.QueryBuilder, db: Db): Knex.QueryBuilder {
  return query.whereNotExists(function () {
    this.select(db.raw('1'))
      .from('ghost_usage_reviews as gr_existing')
      .whereRaw('gr_existing.tenant = t.tenant')
      .andWhereRaw('gr_existing.ticket_id = t.ticket_id');
  });
}

function baseClosedTicketQuery(db: Db, tenant: string, filters: GhostUsageFilters): Knex.QueryBuilder {
  const query = db('tickets as t')
    .leftJoin('statuses as s', function () {
      this.on('t.status_id', 's.status_id')
        .andOn('t.tenant', 's.tenant');
    })
    .where({ 't.tenant': tenant })
    .andWhere(function () {
      this.where('t.is_closed', true).orWhere('s.is_closed', true);
    })
    .andWhere(function () {
      this.whereNull('s.name').orWhereRaw('LOWER(s.name) NOT IN (?, ?, ?)', ['cancelled', 'canceled', 'void']);
    });

  return applyClosedDateFilters(query, filters);
}

function baseHardwareScopedQuery(db: Db, tenant: string, filters: GhostUsageFilters): Knex.QueryBuilder {
  return applyHardwareScope(baseClosedTicketQuery(db, tenant, filters), filters);
}

async function countRows(query: Knex.QueryBuilder): Promise<number> {
  const row = await query.count({ count: '*' }).first<CountRow>();
  return Number(row?.count ?? 0);
}

function normalizeCap(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function toIsoString(value: string | Date | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapCandidateRow(row: RawCandidateRow): GhostUsageCandidateRow {
  return {
    ticket_id: row.ticket_id,
    ticket_number: row.ticket_number,
    title: row.title,
    board_id: row.board_id,
    board_name: row.board_name,
    category_name: row.category_name,
    client_name: row.client_name,
    closed_at: toIsoString(row.closed_at),
    closed_by_name: row.closed_by_name,
    assigned_to_name: row.assigned_to_name,
    review_id: row.review_id,
    ai_classification: row.ai_classification,
    ai_confidence: row.ai_confidence == null ? null : Number(row.ai_confidence),
    ai_reason: row.ai_reason,
    disposition: row.disposition,
  };
}

function candidateRowsBase(db: Db, tenant: string, filters: GhostUsageFilters): Knex.QueryBuilder {
  const query = baseHardwareScopedQuery(db, tenant, filters)
    .leftJoin('boards as b', function () {
      this.on('t.board_id', 'b.board_id')
        .andOn('t.tenant', 'b.tenant');
    })
    .leftJoin('categories as cat', function () {
      this.on('t.category_id', 'cat.category_id')
        .andOn('t.tenant', 'cat.tenant');
    })
    .leftJoin('clients as co', function () {
      this.on('t.client_id', 'co.client_id')
        .andOn('t.tenant', 'co.tenant');
    })
    .leftJoin('users as cb', function () {
      this.on('t.closed_by', 'cb.user_id')
        .andOn('t.tenant', 'cb.tenant');
    })
    .leftJoin('users as au', function () {
      this.on('t.assigned_to', 'au.user_id')
        .andOn('t.tenant', 'au.tenant');
    })
    .leftJoin('ghost_usage_reviews as gr', function () {
      this.on('t.ticket_id', 'gr.ticket_id')
        .andOn('t.tenant', 'gr.tenant');
    })
    .select<RawCandidateRow[]>([
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.board_id',
      'b.board_name',
      'cat.category_name',
      'co.client_name',
      't.closed_at',
      db.raw("NULLIF(TRIM(CONCAT_WS(' ', cb.first_name, cb.last_name)), '') as closed_by_name"),
      db.raw("NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), '') as assigned_to_name"),
      'gr.review_id',
      'gr.ai_classification',
      'gr.ai_confidence',
      'gr.ai_reason',
      'gr.disposition',
    ]);

  return applyMaterialPredicate(query, db, false);
}

export async function queryGhostUsageReport(
  trx: Db,
  tenant: string,
  filters: GhostUsageFilters = {},
  candidateCap = 500,
): Promise<GhostUsageReportResult> {
  const cap = normalizeCap(candidateCap, 500);

  const closedInScope = await countRows(baseClosedTicketQuery(trx, tenant, filters));
  const hardwareScoped = await countRows(baseHardwareScopedQuery(trx, tenant, filters));
  const withConsumption = await countRows(applyMaterialPredicate(baseHardwareScopedQuery(trx, tenant, filters), trx, true));
  const candidatesCount = await countRows(applyMaterialPredicate(baseHardwareScopedQuery(trx, tenant, filters), trx, false));

  const candidateRows = await candidateRowsBase(trx, tenant, filters)
    .andWhere(function () {
      this.whereNull('gr.review_id').orWhere('gr.disposition', 'pending');
    })
    .orderBy('t.closed_at', 'desc')
    .limit(cap);

  const worklistRows = await candidateRowsBase(trx, tenant, filters)
    .andWhere('gr.disposition', 'confirmed')
    .orderBy('gr.reviewed_at', 'desc')
    .limit(200);

  const boards = await trx('boards')
    .select('board_id', 'board_name')
    .where({ tenant, is_inactive: false })
    .orderBy('board_name', 'asc');

  const categories = await trx('categories')
    .select('category_id', 'category_name', 'parent_category')
    .where({ tenant })
    .orderBy('category_name', 'asc');

  return {
    funnel: {
      closed_in_scope: closedInScope,
      hardware_scoped: hardwareScoped,
      with_consumption: withConsumption,
      candidates: candidatesCount,
    },
    candidates: candidateRows.map(mapCandidateRow),
    worklist: worklistRows.map(mapCandidateRow),
    candidate_cap: cap,
    boards,
    categories,
  };
}

function normalizeSettings(rawSettings: unknown): Record<string, any> {
  if (!rawSettings) {
    return {};
  }

  if (typeof rawSettings === 'string') {
    try {
      return JSON.parse(rawSettings);
    } catch {
      return {};
    }
  }

  if (typeof rawSettings === 'object') {
    return rawSettings as Record<string, any>;
  }

  return {};
}

export async function getGhostUsageAiSettings(
  knexOrTrx: Db,
  tenant: string,
): Promise<{ enabled: boolean }> {
  const row = await knexOrTrx('tenant_settings')
    .select('settings')
    .where({ tenant })
    .first<{ settings?: unknown }>();

  const settings = normalizeSettings(row?.settings);
  return {
    enabled: settings.inventory?.ghostUsageAi?.enabled === true,
  };
}

export async function setGhostUsageAiEnabledSetting(
  knexOrTrx: Db,
  tenant: string,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  const row = await knexOrTrx('tenant_settings')
    .select('settings')
    .where({ tenant })
    .first<{ settings?: unknown }>();

  const currentSettings = normalizeSettings(row?.settings);
  const updatedSettings = {
    ...currentSettings,
    inventory: {
      ...(currentSettings.inventory ?? {}),
      ghostUsageAi: {
        ...(currentSettings.inventory?.ghostUsageAi ?? {}),
        enabled,
      },
    },
  };

  await knexOrTrx('tenant_settings')
    .insert({
      tenant,
      settings: JSON.stringify(updatedSettings),
      updated_at: knexOrTrx.fn.now(),
    })
    .onConflict('tenant')
    .merge({
      settings: JSON.stringify(updatedSettings),
      updated_at: new Date().toISOString(),
    });

  return { enabled };
}

export async function selectClassifiableCandidates(
  trx: Db,
  tenant: string,
  filters: GhostUsageFilters,
  limit: number,
): Promise<string[]> {
  const cap = normalizeCap(limit, 0);
  if (cap === 0) {
    return [];
  }

  const query = applyReviewAbsentPredicate(
    applyMaterialPredicate(baseHardwareScopedQuery(trx, tenant, filters), trx, false),
    trx,
  )
    .select<{ ticket_id: string }[]>('t.ticket_id')
    .orderBy('t.closed_at', 'desc')
    .limit(cap);

  const rows = await query;
  return rows.map((row) => row.ticket_id);
}

export async function buildGhostTicketInputs(
  trx: Db,
  tenant: string,
  ticketIds: string[],
): Promise<GhostTicketInput[]> {
  const ids = nonEmptyIds(ticketIds);
  if (ids.length === 0) {
    return [];
  }

  const tickets = await trx('tickets as t')
    .leftJoin('boards as b', function () {
      this.on('t.board_id', 'b.board_id')
        .andOn('t.tenant', 'b.tenant');
    })
    .leftJoin('categories as cat', function () {
      this.on('t.category_id', 'cat.category_id')
        .andOn('t.tenant', 'cat.tenant');
    })
    .select<Array<{
      ticket_id: string;
      title: string | null;
      board_name: string | null;
      category_name: string | null;
    }>>([
      't.ticket_id',
      't.title',
      'b.board_name',
      'cat.category_name',
    ])
    .where({ 't.tenant': tenant })
    .whereIn('t.ticket_id', ids);

  const comments = await trx('comments as c')
    .select<Array<{
      ticket_id: string;
      author_type: string | null;
      is_internal: boolean | null;
      markdown_content: string | null;
    }>>([
      'c.ticket_id',
      'c.author_type',
      'c.is_internal',
      'c.markdown_content',
    ])
    .where({ 'c.tenant': tenant })
    .whereIn('c.ticket_id', ids)
    .whereNotNull('c.markdown_content')
    .andWhereRaw("BTRIM(c.markdown_content) <> ''")
    .orderBy('c.created_at', 'desc');

  const commentsByTicket = new Map<string, string[]>();
  for (const comment of comments) {
    const content = comment.markdown_content?.trim();
    if (!content) {
      continue;
    }
    const author = comment.author_type || 'unknown';
    const label = `${author}${comment.is_internal ? ' (internal)' : ''}`;
    const rendered = `[${label}] ${content}`;
    const list = commentsByTicket.get(comment.ticket_id) ?? [];
    list.push(rendered);
    commentsByTicket.set(comment.ticket_id, list);
  }

  const ticketById = new Map(tickets.map((ticket) => [ticket.ticket_id, ticket]));
  const suffix = '…[truncated]';

  return ids.flatMap((ticketId) => {
    const ticket = ticketById.get(ticketId);
    if (!ticket) {
      return [];
    }

    const text = [
      `Title: ${ticket.title ?? ''}`,
      `Board: ${ticket.board_name ?? ''}`,
      `Category: ${ticket.category_name ?? ''}`,
      '',
      commentsByTicket.get(ticketId)?.join('\n---\n') ?? '',
    ].join('\n');

    return [{
      ticket_id: ticketId,
      text: text.length > 6000 ? `${text.slice(0, 6000 - suffix.length)}${suffix}` : text,
    }];
  });
}

export async function upsertGhostUsageReview(
  trx: Db,
  tenant: string,
  row: {
    ticket_id: string;
    ai_classification: GhostClassificationVerdict;
    ai_confidence: number | null;
    ai_reason: string | null;
    ai_model: string | null;
  },
): Promise<void> {
  await trx('ghost_usage_reviews')
    .insert({
      tenant,
      ticket_id: row.ticket_id,
      ai_classification: row.ai_classification,
      ai_confidence: row.ai_confidence,
      ai_reason: row.ai_reason,
      ai_model: row.ai_model,
      disposition: 'pending',
      updated_at: trx.fn.now(),
    })
    .onConflict(['tenant', 'ticket_id'])
    .merge({
      ai_classification: row.ai_classification,
      ai_confidence: row.ai_confidence,
      ai_reason: row.ai_reason,
      ai_model: row.ai_model,
      updated_at: trx.fn.now(),
    });
}

export async function setGhostUsageReviewDisposition(
  trx: Db,
  tenant: string,
  userId: string,
  reviewId: string,
  disposition: GhostDisposition,
): Promise<boolean> {
  const count = await trx('ghost_usage_reviews')
    .where({ tenant, review_id: reviewId })
    .update({
      disposition,
      reviewed_by: userId,
      reviewed_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

  return Number(count) > 0;
}

function extractFirstJsonObject(raw: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (start === -1) {
      if (char === '{') {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseGhostClassification(raw: string): GhostClassificationResult | null {
  const json = extractFirstJsonObject(raw);
  if (!json) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (!GHOST_CLASSIFICATIONS.includes(record.classification as GhostClassificationVerdict)) {
    return null;
  }

  let confidence = Number(record.confidence);
  if (!Number.isFinite(confidence)) {
    confidence = 0;
  } else if (confidence > 1 && confidence <= 100) {
    confidence /= 100;
  }
  confidence = Math.min(1, Math.max(0, confidence));

  return {
    classification: record.classification as GhostClassificationVerdict,
    confidence,
    reason: String(record.reason ?? '').slice(0, 500),
  };
}
