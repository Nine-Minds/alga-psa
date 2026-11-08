/**
 * Tenant-managed allowlist of download hosts for URL document sources.
 *
 * Effective allowlist = built-in hosts (code, `fetchHosts.ts`) minus the built-ins this
 * tenant disabled, plus the tenant's custom entries. Rows live in `document_fetch_hosts`
 * (`kind` = 'custom' | 'builtin_disabled').
 *
 * Every mutation:
 *  - requires `document:manage_fetch_hosts` (`document:create` does NOT imply it);
 *  - runs in one transaction that also inserts exactly one `audit_logs` row. The audit
 *    insert is NOT best-effort: if it fails, the change rolls back.
 *
 * Plan: ee/docs/plans/2026-10-20-mcp-doc-attachments.md §5.
 */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IUserWithRoles } from '@alga-psa/types';
import { BUILTIN_FETCH_HOSTS, isBuiltinFetchHost } from './fetchHosts';
import { validateHostPattern } from './hostPatternValidator';

export const FETCH_HOSTS_TABLE = 'document_fetch_hosts';
export const MANAGE_FETCH_HOSTS_PERMISSION = { resource: 'document', action: 'manage_fetch_hosts' } as const;

export type FetchHostKind = 'custom' | 'builtin_disabled';

interface FetchHostRow {
  tenant: string;
  entry_id: string;
  kind: FetchHostKind;
  host_pattern: string;
  note: string | null;
  created_by: string | null;
  created_at: Date | string;
}

export type FetchHostFailureCode = 'PERMISSION_DENIED' | 'INVALID' | 'DUPLICATE' | 'NOT_FOUND';
export type FetchHostFailure = { success: false; code: FetchHostFailureCode; error: string };
export type FetchHostSuccess<T = {}> = { success: true } & T;
export type FetchHostResult<T = {}> = FetchHostSuccess<T> | FetchHostFailure;

export interface BuiltinHostView {
  pattern: string;
  label: string;
  enabled: boolean;
}
export interface CustomHostView {
  entryId: string;
  hostPattern: string;
  note: string | null;
  /** Display name of the admin who added it (never an ID). */
  addedBy: string | null;
  addedAt: string;
}
export interface FetchHostSettingsView {
  canManage: boolean;
  builtin: BuiltinHostView[];
  custom: CustomHostView[];
}

interface Ctx {
  knex: Knex;
  tenant: string;
  user: IUserWithRoles;
}

const fail = (code: FetchHostFailureCode, error: string): FetchHostFailure => ({ success: false, code, error });

const PERMISSION_MESSAGE =
  'You need the "Manage allowed download hosts" permission to change this list. Ask an administrator.';

async function canManage({ knex, user }: Ctx): Promise<boolean> {
  return hasPermission(user, MANAGE_FETCH_HOSTS_PERMISSION.resource, MANAGE_FETCH_HOSTS_PERMISSION.action, knex);
}

/** Pure: builtin ∖ disabled ∪ custom. */
export function computeEffectiveHosts(rows: Pick<FetchHostRow, 'kind' | 'host_pattern'>[]): string[] {
  const disabled = new Set(rows.filter((r) => r.kind === 'builtin_disabled').map((r) => r.host_pattern));
  const enabledBuiltins = BUILTIN_FETCH_HOSTS.map((h) => h.pattern).filter((p) => !disabled.has(p));
  const custom = rows.filter((r) => r.kind === 'custom').map((r) => r.host_pattern);
  return [...new Set([...enabledBuiltins, ...custom])];
}

/**
 * The tenant's effective allowlist: one indexed query (PK/unique prefix on `tenant`), no cache.
 * Called once per attach request by `resolveSource`.
 */
export async function loadEffectiveFetchHosts(knex: Knex | Knex.Transaction, tenant: string): Promise<string[]> {
  const rows = await tenantDb(knex, tenant).table(FETCH_HOSTS_TABLE).select('kind', 'host_pattern');
  return computeEffectiveHosts(rows);
}

export async function listFetchHostSettings(ctx: Ctx): Promise<FetchHostResult<{ settings: FetchHostSettingsView }>> {
  const manage = await canManage(ctx);
  if (!manage && !(await hasPermission(ctx.user, 'document', 'read', ctx.knex))) {
    return fail('PERMISSION_DENIED', 'You do not have permission to view this setting.');
  }
  const db = tenantDb(ctx.knex, ctx.tenant);
  const rows: FetchHostRow[] = await db.table(FETCH_HOSTS_TABLE).select('*').orderBy('created_at', 'asc');

  const authorIds = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (authorIds.length > 0) {
    const users = await db.table('users').whereIn('user_id', authorIds).select('user_id', 'first_name', 'last_name', 'username');
    for (const u of users) {
      const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
      names.set(u.user_id, full || u.username);
    }
  }

  const disabled = new Set(rows.filter((r) => r.kind === 'builtin_disabled').map((r) => r.host_pattern));
  return {
    success: true,
    settings: {
      canManage: manage,
      builtin: BUILTIN_FETCH_HOSTS.map((h) => ({ pattern: h.pattern, label: h.label, enabled: !disabled.has(h.pattern) })),
      custom: rows
        .filter((r) => r.kind === 'custom')
        .map((r) => ({
          entryId: r.entry_id,
          hostPattern: r.host_pattern,
          note: r.note,
          addedBy: r.created_by ? (names.get(r.created_by) ?? null) : null,
          addedAt: new Date(r.created_at).toISOString(),
        })),
    },
  };
}

/** Must-write audit insert. Deliberately not `lib/logging/auditLog.ts`, which swallows failures. */
async function writeAudit(
  trx: Knex.Transaction,
  ctx: Ctx,
  entry: { operation: string; recordId: string; before: FetchHostRow | null; after: FetchHostRow | null; note: string | null },
): Promise<void> {
  // audit_logs is protected by an RLS policy keyed on app.current_tenant. Set it for this
  // transaction only, so the insert can never be skipped for a missing GUC (which is what
  // makes lib/logging/auditLog.ts best-effort) and never leaks to the pooled connection.
  await trx.raw("select set_config('app.current_tenant', ?, true)", [ctx.tenant]);
  await tenantDb(trx, ctx.tenant).table('audit_logs').insert({
    audit_id: uuidv4(),
    tenant: ctx.tenant,
    user_id: ctx.user.user_id,
    operation: entry.operation,
    table_name: FETCH_HOSTS_TABLE,
    record_id: entry.recordId,
    changed_data: JSON.stringify({ before: entry.before, after: entry.after }),
    details: JSON.stringify({ note: entry.note }),
    timestamp: new Date().toISOString(),
  });
}

const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === '23505';

async function insertEntry(
  ctx: Ctx,
  kind: FetchHostKind,
  hostPattern: string,
  note: string | null,
  operation: string,
): Promise<FetchHostResult<{ entryId: string }>> {
  try {
    return await withTransaction(ctx.knex, async (trx) => {
      const db = tenantDb(trx, ctx.tenant);
      const existing = await db.table(FETCH_HOSTS_TABLE).where({ kind, host_pattern: hostPattern }).first();
      if (existing) {
        return fail('DUPLICATE', `${hostPattern} is already ${kind === 'custom' ? 'in the list' : 'switched off'}.`);
      }
      const [row] = (await db
        .table(FETCH_HOSTS_TABLE)
        .insert({ tenant: ctx.tenant, entry_id: uuidv4(), kind, host_pattern: hostPattern, note, created_by: ctx.user.user_id })
        .returning('*')) as FetchHostRow[];
      await writeAudit(trx, ctx, { operation, recordId: row.entry_id, before: null, after: row, note });
      return { success: true as const, entryId: row.entry_id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail('DUPLICATE', `${hostPattern} is already in the list.`);
    throw error;
  }
}

async function deleteEntry(
  ctx: Ctx,
  where: Partial<FetchHostRow>,
  operation: string,
): Promise<FetchHostResult> {
  return withTransaction(ctx.knex, async (trx) => {
    const db = tenantDb(trx, ctx.tenant);
    const row = (await db.table(FETCH_HOSTS_TABLE).where(where).first()) as FetchHostRow | undefined;
    if (!row) return fail('NOT_FOUND', 'That entry no longer exists.');
    await db.table(FETCH_HOSTS_TABLE).where({ entry_id: row.entry_id }).del();
    await writeAudit(trx, ctx, { operation, recordId: row.entry_id, before: row, after: null, note: row.note });
    return { success: true as const };
  });
}

export async function addCustomFetchHost(
  ctx: Ctx,
  input: { hostPattern: string; note?: string | null },
): Promise<FetchHostResult<{ entryId: string; hostPattern: string }>> {
  if (!(await canManage(ctx))) return fail('PERMISSION_DENIED', PERMISSION_MESSAGE);
  const checked = validateHostPattern(input.hostPattern);
  if (!checked.ok) return fail('INVALID', checked.message);
  if (isBuiltinFetchHost(checked.pattern)) {
    return fail('INVALID', `${checked.pattern} is already a built-in host. Switch it on in the built-in list instead.`);
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
  const result = await insertEntry(ctx, 'custom', checked.pattern, note, 'document_fetch_host.added');
  return result.success ? { ...result, hostPattern: checked.pattern } : result;
}

export async function removeCustomFetchHost(ctx: Ctx, entryId: string): Promise<FetchHostResult> {
  if (!(await canManage(ctx))) return fail('PERMISSION_DENIED', PERMISSION_MESSAGE);
  return deleteEntry(ctx, { entry_id: entryId, kind: 'custom' }, 'document_fetch_host.removed');
}

export async function disableBuiltinFetchHost(ctx: Ctx, pattern: string): Promise<FetchHostResult> {
  if (!(await canManage(ctx))) return fail('PERMISSION_DENIED', PERMISSION_MESSAGE);
  if (!isBuiltinFetchHost(pattern)) return fail('INVALID', `${pattern} is not a built-in host.`);
  const result = await insertEntry(ctx, 'builtin_disabled', pattern, null, 'document_fetch_host.builtin_disabled');
  // Already switched off is a no-op, not an error: nothing changed, so nothing is audited.
  if (!result.success && result.code === 'DUPLICATE') return { success: true };
  return result.success ? { success: true } : result;
}

export async function enableBuiltinFetchHost(ctx: Ctx, pattern: string): Promise<FetchHostResult> {
  if (!(await canManage(ctx))) return fail('PERMISSION_DENIED', PERMISSION_MESSAGE);
  if (!isBuiltinFetchHost(pattern)) return fail('INVALID', `${pattern} is not a built-in host.`);
  const result = await deleteEntry(ctx, { kind: 'builtin_disabled', host_pattern: pattern }, 'document_fetch_host.builtin_enabled');
  // Already on is a no-op.
  if (!result.success && result.code === 'NOT_FOUND') return { success: true };
  return result;
}
