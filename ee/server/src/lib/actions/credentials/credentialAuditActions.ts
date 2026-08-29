'use server';

/**
 * Credentials vault audit reader (EE-only, Pro tier).
 *
 * Read-only surface for the audit trail the vault writes: per-credential
 * history and the vault-wide audit log. Gating mirrors credentialActions:
 * `withAuth` + `hasPermission(user, 'credential', 'audit')` +
 * `assertTierAccess(TIER_FEATURES.CREDENTIALS)`.
 *
 * SECURITY — the audit read-scope is the credential read-scope, never weaker:
 *   - native `record_id`s join to the credentials table and get the exact
 *     ACL predicate the list uses, so activity on a restricted credential the
 *     viewer cannot otherwise see stays invisible (an audit log that leaked
 *     it would become a side channel revealing the credential exists);
 *   - Hudu `record_id`s (`hudu:…`) do not exist in the credentials table;
 *     they are client-bound and shown only when the viewer may read that
 *     client's credentials (Hudu rows are not per-item restricted);
 *   - Hudu password reveals (`writeHuduPasswordRevealAudit`) write
 *     `table_name='clients'` with `record_id` = client id; they are surfaced
 *     as vault events, scoped by the same client rule.
 *
 * No values ever leave this action. It reads metadata columns and `details`
 * only (value-free by the writer's contract), and every `details` /
 * `changed_data` object is run through `redactSensitiveValues` as defense in
 * depth so a future write site that carelessly adds a value is caught here
 * rather than shown.
 */

import type { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import type { CredentialAuditOperation } from '../../credentials/audit';
import {
  authorizeCredentialRecord,
  compileCredentialReadScopeSql,
  createCredentialAuthorizationContext,
  type CredentialAuthorizationContext,
  type CredentialRow,
  type CredentialGrantRow,
} from '../../credentials/credentialAuthorization';

/** The nine operations the vault screen can surface (eight + the Hudu reveal). */
export type CredentialAuditEventOperation = CredentialAuditOperation | 'hudu_password_reveal';

export interface CredentialAuditFilter {
  /** Per-credential history (still ANDed with the read-scope, never instead of it). */
  credentialId?: string;
  operations?: CredentialAuditEventOperation[];
  actorUserId?: string;
  clientId?: string;
  from?: string;
  to?: string;
  /** Keyset cursor: strictly-before (timestamp, audit_id). */
  cursor?: { timestamp: string; auditId: string } | null;
  /** Default 50, max 200. */
  limit?: number;
}

export interface CredentialAuditEvent {
  auditId: string;
  timestamp: string;
  operation: CredentialAuditEventOperation;
  /** `name` is null when the row is a system action or the user was removed. */
  actor: { userId: string | null; name: string | null };
  credentialId: string;
  /** Resolved for native rows; null for deleted credentials and Hudu rows. */
  credentialName: string | null;
  clientId: string | null;
  clientName: string | null;
  /** Association events only. */
  entity?: { type: string; id: string } | null;
  /** `credential_updated` enrichment — field names only, never values. */
  changedFields?: string[];
  /** `credential_grants_changed` enrichment — counts only. */
  grantsDelta?: { added: number; removed: number };
}

export interface CredentialAuditPage {
  events: CredentialAuditEvent[];
  nextCursor: { timestamp: string; auditId: string } | null;
}

const SENSITIVE_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization)/i;

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValues(entry));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '***'];
      }
      return [key, redactSensitiveValues(val)];
    });
    return Object.fromEntries(entries);
  }
  return value;
}

type AuditRow = {
  audit_id: string;
  user_id: string | null;
  operation: string;
  table_name: string;
  record_id: string;
  changed_data: Record<string, unknown>;
  details: Record<string, unknown>;
  timestamp: Date | string;
};

async function loadUserNames(
  trx: Knex.Transaction,
  tenant: string,
  userIds: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0)));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await tenantDb(trx, tenant)
    .table<{ user_id: string; first_name: string | null; last_name: string | null; username: string }>('users')
    .whereIn('user_id', unique)
    .select('user_id', 'first_name', 'last_name', 'username');
  for (const row of rows) {
    const display = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username;
    map.set(row.user_id, display);
  }
  return map;
}

async function loadCredentialNames(
  trx: Knex.Transaction,
  tenant: string,
  credentialIds: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(credentialIds.filter((id) => typeof id === 'string' && id.length > 0)));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await tenantDb(trx, tenant)
    .table<{ credential_id: string; name: string }>('credentials')
    .whereIn('credential_id', unique)
    .select('credential_id', 'name');
  for (const row of rows) {
    map.set(row.credential_id, row.name);
  }
  return map;
}

async function loadClientNames(
  trx: Knex.Transaction,
  tenant: string,
  clientIds: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(clientIds.filter((id) => typeof id === 'string' && id.length > 0)));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await tenantDb(trx, tenant)
    .table<{ client_id: string; client_name: string }>('clients')
    .whereIn('client_id', unique)
    .select('client_id', 'client_name');
  for (const row of rows) {
    map.set(row.client_id, row.client_name);
  }
  return map;
}

async function loadGrants(
  trx: Knex.Transaction,
  tenant: string,
  credentialIds: string[]
): Promise<Map<string, CredentialGrantRow[]>> {
  const unique = Array.from(new Set(credentialIds));
  const map = new Map<string, CredentialGrantRow[]>();
  if (unique.length === 0) return map;
  const rows = await tenantDb(trx, tenant)
    .table<CredentialGrantRow & { credential_id: string }>('credential_access_grants')
    .whereIn('credential_id', unique)
    .select('credential_id', 'subject_type', 'subject_id');
  for (const row of rows) {
    const list = map.get(row.credential_id) ?? [];
    list.push({ subject_type: row.subject_type, subject_id: row.subject_id });
    map.set(row.credential_id, list);
  }
  return map;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Candidate client ids a Hudu audit row could belong to: the `client_id`
 * stamped on `table_name='credentials'` Hudu rows and the `record_id` (client
 * id) of `hudu_password_reveal` rows. The kernel then decides which of these
 * the viewer may read.
 */
async function collectCandidateHuduClientIds(
  trx: Knex.Transaction,
  tenant: string
): Promise<string[]> {
  const rows = await tenantDb(trx, tenant)
    .table('audit_logs')
    .where(function (base) {
      base.where(function (creds) {
        creds.where('table_name', 'credentials');
        creds.whereILike('record_id', 'hudu:%');
      });
      base.orWhere(function (reveal) {
        reveal.where('table_name', 'clients');
        reveal.where('operation', 'hudu_password_reveal');
      });
    })
    .select('table_name', 'record_id', 'details');
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.table_name === 'clients') {
      if (typeof row.record_id === 'string' && row.record_id.length > 0) ids.add(row.record_id);
      continue;
    }
    const clientId = (row.details as { client_id?: unknown } | null)?.client_id;
    if (typeof clientId === 'string' && clientId.length > 0) ids.add(clientId);
  }
  return Array.from(ids);
}

/**
 * Parse a Hudu synthetic credential id (`hudu:<companyId>:<passwordId>`) back
 * into its parts. Hudu password reveals store the client id in `record_id` and
 * the company/password ids only in `details`, so a per-credential History must
 * match reveal rows through these raw ids rather than `record_id`.
 */
function parseHuduCredentialId(id: string): { companyId: string; passwordId: string } | null {
  const parts = id.split(':');
  if (parts.length !== 3 || parts[0] !== 'hudu' || parts[1] === '' || parts[2] === '') return null;
  return { companyId: parts[1], passwordId: parts[2] };
}

/**
 * Run the JS authorization kernel over the live credential set (the fallback
 * used when a bundle rule is not representable in SQL). Produces the explicit
 * allowed-id list the list screen would show.
 */
async function loadAuthorizedLiveCredentialIds(
  trx: Knex.Transaction,
  authContext: CredentialAuthorizationContext
): Promise<string[]> {
  const rows = await tenantDb(trx, authContext.subject.tenant)
    .table<Pick<CredentialRow, 'credential_id' | 'created_by' | 'client_id' | 'is_restricted'>>('credentials')
    .select('credential_id', 'created_by', 'client_id', 'is_restricted');
  const grantsByCredential = await loadGrants(
    trx,
    authContext.subject.tenant,
    rows.map((row) => row.credential_id)
  );
  const allowedIds: string[] = [];
  for (const row of rows) {
    const ok = await authorizeCredentialRecord(
      trx,
      authContext,
      row,
      grantsByCredential.get(row.credential_id) ?? []
    );
    if (ok) allowedIds.push(row.credential_id);
  }
  return allowedIds;
}

export const getCredentialAuditEvents = withAuth(
  async (user: IUserWithRoles, context: { tenant: string }, input: CredentialAuditFilter = {}): Promise<CredentialAuditPage> => {
    const { tenant } = context;
    if (user.user_type === 'client') {
      throw new Error('Forbidden');
    }
    const allowed = await hasPermission(user, 'credential', 'audit');
    if (!allowed) {
      throw new Error('Forbidden: insufficient permissions (credential audit)');
    }
    await assertTierAccess(TIER_FEATURES.CREDENTIALS);

    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const { knex } = await createTenantKnex(tenant);

    return withTransaction(knex, async (trx) => {
      const authContext = await createCredentialAuthorizationContext(trx, tenant, user);

      // Native read-scope: the exact predicate the credential list compiles.
      // When a bundle rule is not representable in SQL the caller falls back
      // to the JS kernel over the full credential set (correctness over
      // performance), producing an explicit allowed-id list.
      const scopeQuery = tenantDb(trx, tenant).scoped('credentials as cr');
      const scope = compileCredentialReadScopeSql(scopeQuery, authContext);
      const liveNativeSubquery = scope.supported
        // `audit_logs.record_id` is varchar while `credentials.credential_id`
        // is uuid; cast the subquery column to text so the comparison holds
        // without casting hudu-prefixed record ids (which would throw).
        ? scopeQuery.builder.clone().select(trx.raw('cr.credential_id::text as credential_id'))
        : null;
      const liveNativeIds = scope.supported
        ? null
        : await loadAuthorizedLiveCredentialIds(trx, authContext);

      // Hudu client scope: the viewer may see a client's Hudu rows only when
      // the kernel's bundle narrowing admits that client (Hudu rows are not
      // per-item restricted).
      const candidateClientIds = await collectCandidateHuduClientIds(trx, tenant);
      const authorizedClientIds: string[] = [];
      for (const clientId of candidateClientIds) {
        const ok = await authorizeCredentialRecord(trx, authContext, {
          credential_id: `hudu:${clientId}`,
          created_by: '',
          client_id: clientId,
          is_restricted: false,
        }, []);
        if (ok) authorizedClientIds.push(clientId);
      }

      const q = tenantDb(trx, tenant).table('audit_logs as al');

      // Base: vault activity only — `credentials` rows plus the Hudu password
      // reveals that write `table_name='clients'`.
      q.where(function (base) {
        base.where('table_name', 'credentials');
        base.orWhere(function (reveal) {
          reveal.where('table_name', 'clients');
          reveal.where('operation', 'hudu_password_reveal');
        });
      });

      // Read-scope (security core — not optional).
      q.where(function (scopeWhere) {
        scopeWhere.where(function (native) {
          native.where('table_name', 'credentials');
          if (liveNativeSubquery !== null) {
            native.whereIn('record_id', liveNativeSubquery);
          } else {
            const live = liveNativeIds ?? [];
            if (live.length === 0) native.whereRaw('1 = 0');
            else native.whereIn('record_id', live);
          }
        });
        scopeWhere.orWhere(function (huduCreds) {
          huduCreds.where('table_name', 'credentials');
          huduCreds.whereILike('record_id', 'hudu:%');
          if (authorizedClientIds.length === 0) {
            huduCreds.whereRaw('1 = 0');
          } else {
            // Individual `?` params keep the comparison text-vs-text; a single
            // array param would be inferred as uuid[] and fail against the
            // jsonb text extraction.
            huduCreds.whereRaw(
              `(details->>'client_id') IN (${authorizedClientIds.map(() => '?').join(', ')})`,
              authorizedClientIds
            );
          }
        });
        scopeWhere.orWhere(function (huduReveal) {
          huduReveal.where('table_name', 'clients');
          huduReveal.where('operation', 'hudu_password_reveal');
          if (authorizedClientIds.length === 0) huduReveal.whereRaw('1 = 0');
          else huduReveal.whereIn('record_id', authorizedClientIds);
        });
      });

      // Filters (all ANDed; credentialId is still read-scoped above).
      if (input.credentialId) {
        // For a native credential `record_id` matches directly. A Hudu
        // synthetic id (`hudu:<company>:<password>`) must ALSO match the
        // `hudu_password_reveal` rows, which store the client id in
        // `record_id` and the company/password ids only in `details`.
        const huduRef = parseHuduCredentialId(input.credentialId);
        q.where(function (credWhere) {
          credWhere.where('record_id', input.credentialId!);
          if (huduRef) {
            credWhere.orWhere(function (revealMatch) {
              revealMatch.where('table_name', 'clients');
              revealMatch.where('operation', 'hudu_password_reveal');
              revealMatch.whereRaw(`(details->>'hudu_company_id') = ?`, [huduRef.companyId]);
              revealMatch.whereRaw(`(details->>'hudu_password_id') = ?`, [huduRef.passwordId]);
            });
          }
        });
      }
      if (input.operations && input.operations.length > 0) {
        q.whereIn('operation', input.operations as string[]);
      }
      if (input.actorUserId) {
        q.where('user_id', input.actorUserId);
      }
      if (input.clientId) {
        q.where(function (clientWhere) {
          clientWhere.whereRaw(`(details->>'client_id') = ?`, [input.clientId]);
          clientWhere.orWhere(function (revealClient) {
            revealClient.where('table_name', 'clients');
            revealClient.where('operation', 'hudu_password_reveal');
            revealClient.where('record_id', input.clientId);
          });
        });
      }
      if (input.from) {
        q.where('timestamp', '>=', input.from);
      }
      if (input.to) {
        q.where('timestamp', '<=', input.to);
      }
      if (input.cursor) {
        q.where(function (cursorWhere) {
          cursorWhere.where('timestamp', '<', input.cursor!.timestamp);
          cursorWhere.orWhere(function (sameTimestamp) {
            sameTimestamp.where('timestamp', input.cursor!.timestamp);
            sameTimestamp.where('audit_id', '<', input.cursor!.auditId);
          });
        });
      }

      const rows = await q
        .orderBy('timestamp', 'desc')
        .orderBy('audit_id', 'desc')
        .limit(limit + 1)
        .select<AuditRow[]>(
          'al.audit_id',
          'al.user_id',
          'al.operation',
          'al.table_name',
          'al.record_id',
          'al.changed_data',
          'al.details',
          'al.timestamp'
        );

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      const actorIds = pageRows.flatMap((row) => (row.user_id ? [row.user_id] : []));
      const nativeCredentialIds = pageRows
        .filter((row) => row.table_name === 'credentials' && !String(row.record_id).startsWith('hudu:'))
        .map((row) => row.record_id);
      const clientIds = pageRows.flatMap((row) => {
        if (row.table_name === 'clients') return [row.record_id];
        const clientId = (row.details as { client_id?: unknown } | null)?.client_id;
        return typeof clientId === 'string' && clientId.length > 0 ? [clientId] : [];
      });

      const [userNames, credentialNames, clientNameMap] = await Promise.all([
        loadUserNames(trx, tenant, actorIds),
        loadCredentialNames(trx, tenant, nativeCredentialIds),
        loadClientNames(trx, tenant, clientIds),
      ]);

      const events: CredentialAuditEvent[] = pageRows.map((row) => {
        const rawDetails = (row.details ?? {}) as Record<string, unknown>;
        // Defense in depth: the event projection never returns raw `details`,
        // but the redaction pass would catch a future write site that
        // carelessly added a value. The Hudu ref reconstruction must read the
        // raw structural keys first — the pass deliberately mangles
        // `hudu_password_id` (it matches the sensitive-key pattern).
        let credentialId = row.record_id;
        if (
          row.table_name === 'clients'
          && typeof rawDetails.hudu_company_id === 'string'
          && typeof rawDetails.hudu_password_id === 'string'
        ) {
          credentialId = `hudu:${rawDetails.hudu_company_id}:${rawDetails.hudu_password_id}`;
        }

        const details = redactSensitiveValues(rawDetails) as Record<string, unknown>;
        const entityType = details.entity_type;
        const entityId = details.entity_id;
        const changedFields = details.changed_fields;
        const grantsAdded = details.grants_added;
        const grantsRemoved = details.grants_removed;
        const clientIdForRow =
          row.table_name === 'clients'
            ? row.record_id
            : typeof details.client_id === 'string'
              ? details.client_id
              : null;

        const event: CredentialAuditEvent = {
          auditId: row.audit_id,
          timestamp: toIso(row.timestamp),
          operation: row.operation as CredentialAuditEventOperation,
          actor: {
            userId: row.user_id ?? null,
            name: row.user_id ? (userNames.get(row.user_id) ?? null) : null,
          },
          credentialId,
          credentialName:
            row.table_name === 'credentials' && !String(row.record_id).startsWith('hudu:')
              ? credentialNames.get(row.record_id) ?? null
              : null,
          clientId: clientIdForRow,
          clientName: clientIdForRow ? clientNameMap.get(clientIdForRow) ?? null : null,
          entity:
            typeof entityType === 'string' && typeof entityId === 'string'
              ? { type: entityType, id: entityId }
              : null,
          changedFields: Array.isArray(changedFields)
            ? (changedFields as unknown[]).filter((field): field is string => typeof field === 'string')
            : undefined,
          grantsDelta:
            typeof grantsAdded === 'number' || typeof grantsRemoved === 'number'
              ? {
                  added: typeof grantsAdded === 'number' ? grantsAdded : 0,
                  removed: typeof grantsRemoved === 'number' ? grantsRemoved : 0,
                }
              : undefined,
        };
        return event;
      });

      const nextCursor = hasMore && pageRows.length > 0
        ? { timestamp: toIso(pageRows[pageRows.length - 1].timestamp), auditId: pageRows[pageRows.length - 1].audit_id }
        : null;

      return { events, nextCursor };
    });
  }
);
