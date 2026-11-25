/**
 * Client Portal Notices: persistence and query helpers (plan pl-737e90f8).
 *
 * Every function takes a Knex connection or transaction plus the tenant and goes
 * through tenantDb, so tenant filtering is never optional. Relations (notice ->
 * targets/dismissals, target -> client/tag) are enforced here, because the S1
 * tables carry no foreign keys. The audience/tag join and the target replace are
 * written for reuse by the S4 portal read path.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  getNoticeStatus,
  type ClientPortalNoticeInput,
  type NoticeAudienceType,
  type NoticeContent,
  type NoticeSeverity,
  type NoticeStatus,
} from './clientPortalNotices';

type Conn = Knex | Knex.Transaction;

export const NOTICES_TABLE = 'client_portal_notices';
export const TARGETS_TABLE = 'client_portal_notice_targets';
export const DISMISSALS_TABLE = 'client_portal_notice_dismissals';

export type NoticeTargetType = 'client' | 'tag';

export interface NoticeAudienceSelection {
  audienceType: NoticeAudienceType;
  targetIds: string[];
}

export interface NamedTarget {
  id: string;
  name: string;
}

export interface NoticeRow {
  tenant: string;
  notice_id: string;
  severity: NoticeSeverity;
  content: NoticeContent;
  link_url: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  dismissible: boolean;
  audience_type: NoticeAudienceType;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NoticeListItem {
  notice_id: string;
  severity: NoticeSeverity;
  content: NoticeContent;
  link_url: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  dismissible: boolean;
  audience_type: NoticeAudienceType;
  created_at: Date;
  updated_at: Date;
  /** Derived in TypeScript from S2 getNoticeStatus; never stored. */
  status: NoticeStatus;
  /** Names only: client names and/or tag names. Empty for audience_type 'all'. */
  audience_client_names: string[];
  audience_tag_names: string[];
}

export interface NoticeDetail extends Omit<NoticeListItem, 'audience_client_names' | 'audience_tag_names'> {
  audience_clients: NamedTarget[];
  audience_tags: NamedTarget[];
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

function targetTypeFor(audienceType: NoticeAudienceType): NoticeTargetType | null {
  return audienceType === 'clients' ? 'client' : audienceType === 'tags' ? 'tag' : null;
}

/** The target ids an input carries for its audience type (none for 'all'). */
export function targetIdsForInput(input: Pick<ClientPortalNoticeInput, 'audience_type' | 'audience_client_ids' | 'audience_tag_ids'>): string[] {
  const ids =
    input.audience_type === 'clients' ? input.audience_client_ids
    : input.audience_type === 'tags' ? input.audience_tag_ids
    : [];
  return Array.from(new Set(ids ?? []));
}

// ---------------------------------------------------------------------------
// Target existence (application-enforced relations)
// ---------------------------------------------------------------------------

/** Returns the ids that do NOT exist in this tenant for the given target type. */
export async function findMissingTargetIds(
  conn: Conn,
  tenant: string,
  targetType: NoticeTargetType,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = tenantDb(conn, tenant);
  const rows: Array<{ id: string }> =
    targetType === 'client'
      ? await db.table('clients').select({ id: 'client_id' }).whereIn('client_id', ids)
      : await db.table('tag_definitions').select({ id: 'tag_id' }).where('tagged_type', 'client').whereIn('tag_id', ids);
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}

// ---------------------------------------------------------------------------
// Audience resolution (shared with S4)
// ---------------------------------------------------------------------------

/** Client ids and names for tenant clients carrying ANY of the given tags. */
export async function selectClientsWithAnyTag(
  conn: Conn,
  tenant: string,
  tagIds: string[],
): Promise<NamedTarget[]> {
  if (tagIds.length === 0) return [];
  const db = tenantDb(conn, tenant);
  const query = db.table('clients as c').distinct({ id: 'c.client_id', name: 'c.client_name' });
  db.tenantJoin(query, 'tag_mappings as tm', 'c.client_id', 'tm.tagged_id');
  query.where('tm.tagged_type', 'client').whereIn('tm.tag_id', tagIds);
  return query;
}

/** Names of the tenant's clients matching an audience selection, sorted. Read-only. */
export async function previewAudienceClientNames(
  conn: Conn,
  tenant: string,
  audience: NoticeAudienceSelection,
): Promise<string[]> {
  const db = tenantDb(conn, tenant);
  let rows: Array<{ name: string }>;
  if (audience.audienceType === 'all') {
    rows = await db.table('clients').select({ name: 'client_name' });
  } else if (audience.audienceType === 'clients') {
    rows = audience.targetIds.length === 0
      ? []
      : await db.table('clients').select({ name: 'client_name' }).whereIn('client_id', audience.targetIds);
  } else {
    rows = await selectClientsWithAnyTag(conn, tenant, audience.targetIds);
  }
  return Array.from(new Set(rows.map((r) => r.name))).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadTargets(conn: Conn, tenant: string, noticeIds: string[]) {
  if (noticeIds.length === 0) return [];
  return tenantDb(conn, tenant)
    .table(TARGETS_TABLE)
    .select('notice_id', 'target_type', 'target_id')
    .whereIn('notice_id', noticeIds) as Promise<Array<{ notice_id: string; target_type: NoticeTargetType; target_id: string }>>;
}

/** One batched query per target type: id -> name. */
async function resolveTargetNames(
  conn: Conn,
  tenant: string,
  targets: Array<{ target_type: NoticeTargetType; target_id: string }>,
) {
  const db = tenantDb(conn, tenant);
  const clientIds = Array.from(new Set(targets.filter((t) => t.target_type === 'client').map((t) => t.target_id)));
  const tagIds = Array.from(new Set(targets.filter((t) => t.target_type === 'tag').map((t) => t.target_id)));
  const [clients, tags] = await Promise.all([
    clientIds.length
      ? db.table('clients').select({ id: 'client_id', name: 'client_name' }).whereIn('client_id', clientIds)
      : Promise.resolve([]),
    tagIds.length
      ? db.table('tag_definitions').select({ id: 'tag_id', name: 'tag_text' }).where('tagged_type', 'client').whereIn('tag_id', tagIds)
      : Promise.resolve([]),
  ]);
  return {
    clientNames: new Map<string, string>(clients.map((r: any): [string, string] => [r.id, r.name])),
    tagNames: new Map<string, string>(tags.map((r: any): [string, string] => [r.id, r.name])),
  };
}

function toTime(value: Date | string | null): number {
  return value ? new Date(value).getTime() : 0;
}

/** PRD order: severity (critical first), then most recent. */
export function compareNoticesForAdmin(a: Pick<NoticeRow, 'severity' | 'created_at'>, b: Pick<NoticeRow, 'severity' | 'created_at'>): number {
  return (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) || toTime(b.created_at) - toTime(a.created_at);
}

export async function listNoticesWithAudience(conn: Conn, tenant: string, now: Date): Promise<NoticeListItem[]> {
  const notices = (await tenantDb(conn, tenant).table(NOTICES_TABLE).select('*')) as NoticeRow[];
  notices.sort(compareNoticesForAdmin);
  const targets = await loadTargets(conn, tenant, notices.map((n) => n.notice_id));
  const names = await resolveTargetNames(conn, tenant, targets);

  return notices.map((n) => {
    const mine = targets.filter((t) => t.notice_id === n.notice_id);
    const pick = (type: NoticeTargetType, map: Map<string, string>) =>
      mine.filter((t) => t.target_type === type).map((t) => map.get(t.target_id)).filter((x): x is string => !!x).sort((a, b) => a.localeCompare(b));
    return {
      notice_id: n.notice_id,
      severity: n.severity,
      content: n.content,
      link_url: n.link_url,
      starts_at: n.starts_at,
      ends_at: n.ends_at,
      dismissible: n.dismissible,
      audience_type: n.audience_type,
      created_at: n.created_at,
      updated_at: n.updated_at,
      status: getNoticeStatus(n, now),
      audience_client_names: pick('client', names.clientNames),
      audience_tag_names: pick('tag', names.tagNames),
    };
  });
}

export async function getNoticeDetail(conn: Conn, tenant: string, noticeId: string, now: Date): Promise<NoticeDetail | null> {
  const n = (await tenantDb(conn, tenant).table(NOTICES_TABLE).where({ notice_id: noticeId }).first()) as NoticeRow | undefined;
  if (!n) return null;
  const targets = await loadTargets(conn, tenant, [noticeId]);
  const names = await resolveTargetNames(conn, tenant, targets);
  const named = (type: NoticeTargetType, map: Map<string, string>): NamedTarget[] =>
    targets
      .filter((t) => t.target_type === type && map.has(t.target_id))
      .map((t) => ({ id: t.target_id, name: map.get(t.target_id)! }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return {
    notice_id: n.notice_id,
    severity: n.severity,
    content: n.content,
    link_url: n.link_url,
    starts_at: n.starts_at,
    ends_at: n.ends_at,
    dismissible: n.dismissible,
    audience_type: n.audience_type,
    created_at: n.created_at,
    updated_at: n.updated_at,
    status: getNoticeStatus(n, now),
    audience_clients: named('client', names.clientNames),
    audience_tags: named('tag', names.tagNames),
  };
}

// ---------------------------------------------------------------------------
// Writes (call inside a transaction)
// ---------------------------------------------------------------------------

function nullableDate(value: ClientPortalNoticeInput['starts_at']): Date | null {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date ? value : new Date(value);
}

export function noticeColumnsFromInput(input: ClientPortalNoticeInput) {
  return {
    severity: input.severity,
    content: JSON.stringify(input.content),
    link_url: input.link_url ? input.link_url : null,
    starts_at: nullableDate(input.starts_at),
    ends_at: nullableDate(input.ends_at),
    dismissible: input.dismissible,
    audience_type: input.audience_type,
  };
}

/** Replace the notice's targets: delete all, insert the new set. */
export async function replaceNoticeTargets(
  trx: Conn,
  tenant: string,
  noticeId: string,
  audienceType: NoticeAudienceType,
  targetIds: string[],
): Promise<void> {
  const db = tenantDb(trx, tenant);
  await db.table(TARGETS_TABLE).where({ notice_id: noticeId }).delete();
  const type = targetTypeFor(audienceType);
  if (!type || targetIds.length === 0) return;
  await db.table(TARGETS_TABLE).insert(
    targetIds.map((id) => ({ tenant, notice_id: noticeId, target_type: type, target_id: id })),
  );
}

export async function insertNotice(trx: Conn, tenant: string, userId: string, input: ClientPortalNoticeInput): Promise<string> {
  const noticeId = randomUUID();
  await tenantDb(trx, tenant).table(NOTICES_TABLE).insert({
    tenant,
    notice_id: noticeId,
    ...noticeColumnsFromInput(input),
    created_by: userId,
  });
  await replaceNoticeTargets(trx, tenant, noticeId, input.audience_type, targetIdsForInput(input));
  return noticeId;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort()
      .filter((k) => (value as any)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Open question 2 (PRD proposed answer): dismissals are cleared when the CONTENT
 * (message/link label per locale, and the link URL), the AUDIENCE TYPE or the TARGET
 * SET changes. Schedule, severity and dismissible-only edits keep dismissals.
 */
export function shouldClearDismissals(
  existing: Pick<NoticeRow, 'content' | 'link_url' | 'audience_type'>,
  existingTargetIds: string[],
  next: ClientPortalNoticeInput,
): boolean {
  if (stableStringify(existing.content) !== stableStringify(next.content)) return true;
  if ((existing.link_url ?? null) !== (next.link_url ? next.link_url : null)) return true;
  if (existing.audience_type !== next.audience_type) return true;
  const a = [...existingTargetIds].sort().join(',');
  const b = [...targetIdsForInput(next)].sort().join(',');
  return a !== b;
}

/** Updates the notice and replaces targets. Returns false if the notice does not exist. */
export async function updateNotice(trx: Conn, tenant: string, noticeId: string, input: ClientPortalNoticeInput): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const existing = (await db.table(NOTICES_TABLE).where({ notice_id: noticeId }).forUpdate().first()) as NoticeRow | undefined;
  if (!existing) return false;
  const existingTargets = (await loadTargets(trx, tenant, [noticeId])).map((t) => t.target_id);

  await db.table(NOTICES_TABLE).where({ notice_id: noticeId }).update({
    ...noticeColumnsFromInput(input),
    updated_at: new Date(),
  });
  await replaceNoticeTargets(trx, tenant, noticeId, input.audience_type, targetIdsForInput(input));

  if (shouldClearDismissals(existing, existingTargets, input)) {
    await db.table(DISMISSALS_TABLE).where({ notice_id: noticeId }).delete();
  }
  return true;
}

/** Deletes targets, dismissals and the notice. Returns false if the notice does not exist. */
export async function deleteNotice(trx: Conn, tenant: string, noticeId: string): Promise<boolean> {
  const db = tenantDb(trx, tenant);
  const existing = await db.table(NOTICES_TABLE).where({ notice_id: noticeId }).first();
  if (!existing) return false;
  await db.table(TARGETS_TABLE).where({ notice_id: noticeId }).delete();
  await db.table(DISMISSALS_TABLE).where({ notice_id: noticeId }).delete();
  await db.table(NOTICES_TABLE).where({ notice_id: noticeId }).delete();
  return true;
}
