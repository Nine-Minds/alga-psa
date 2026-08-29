/**
 * Native Alga credentials store (EE-only): Postgres-backed, kernel-authorized,
 * envelope-encrypted. Implements the CredentialSource abstraction.
 *
 * SECURITY: plaintext values exist only (a) between request and encryption in
 * the write path, and (b) in a reveal response. They are never logged, never
 * cached, never placed in list payloads. Every reveal / seed-reveal writes a
 * fail-closed audit row inside the same transaction as the read (no audit row
 * ⇒ no value). Create/update/delete/grants-changed also audit.
 */

import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type {
  CredentialAttachment,
  CredentialDetail,
  CredentialGrant,
  CredentialListFilter,
  CredentialRevealResult,
  CredentialSource,
  CredentialSourceContext,
  CredentialSummary,
  CredentialWriteInput,
} from './contracts';
import {
  compileCredentialReadScopeSql,
  createCredentialAuthorizationContext,
  authorizeCredentialRecord,
  toCredentialAuthorizationRecord,
  type CredentialGrantRow,
  type CredentialRow,
} from './credentialAuthorization';
import {
  decryptCredentialValue,
  encryptCredentialValues,
  isCredentialEncryptionScheme,
  type CredentialEncryptionScheme,
} from './encryption';
import { generateTotp, normalizeOtpSecret } from './totp';
import { writeCredentialAudit } from './audit';
import { assertAttachmentsMatchClient } from './associations';

type CredentialRowProjection = CredentialRow;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toSummary(
  row: CredentialRowProjection,
  clientName: string | null,
  attachments: CredentialAttachment[]
): CredentialSummary {
  return {
    id: row.credential_id,
    source: 'alga',
    clientId: row.client_id,
    clientName,
    name: row.name,
    username: row.username ?? null,
    url: row.url ?? null,
    description: row.description ?? null,
    hasOtp: Boolean(row.otp_secret_ciphertext),
    isRestricted: row.is_restricted === true,
    folderName: null,
    externalUrl: null,
    attachments,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function loadClientNames(trx: Knex | Knex.Transaction, tenant: string, clientIds: string[]): Promise<Map<string, string>> {
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

async function loadGrants(trx: Knex | Knex.Transaction, tenant: string, credentialIds: string[]): Promise<Map<string, CredentialGrantRow[]>> {
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

async function loadAssociations(
  trx: Knex | Knex.Transaction,
  tenant: string,
  credentialIds: string[]
): Promise<Map<string, CredentialAttachment[]>> {
  const unique = Array.from(new Set(credentialIds));
  const map = new Map<string, CredentialAttachment[]>();
  if (unique.length === 0) return map;
  const rows = await tenantDb(trx, tenant)
    .table<{ credential_id: string; entity_id: string; entity_type: string }>('credential_associations')
    .whereIn('credential_id', unique)
    .select('credential_id', 'entity_id', 'entity_type');
  for (const row of rows) {
    const list = map.get(row.credential_id) ?? [];
    list.push({ entityType: row.entity_type as CredentialAttachment['entityType'], entityId: row.entity_id });
    map.set(row.credential_id, list);
  }
  return map;
}

async function fetchCredentialById(
  trx: Knex | Knex.Transaction,
  tenant: string,
  id: string,
  forUpdate = false
): Promise<CredentialRowProjection | null> {
  const query = tenantDb(trx, tenant)
    .table<CredentialRowProjection>('credentials')
    .where('credential_id', id);
  if (forUpdate) query.forUpdate();
  return query.first();
}

async function fetchGrantsForCredential(trx: Knex | Knex.Transaction, tenant: string, id: string): Promise<CredentialGrantRow[]> {
  const rows = await tenantDb(trx, tenant)
    .table<CredentialGrantRow>('credential_access_grants')
    .where('credential_id', id)
    .select('subject_type', 'subject_id');
  return rows;
}

function requireScheme(row: CredentialRowProjection): CredentialEncryptionScheme {
  if (!isCredentialEncryptionScheme(row.encryption_scheme)) {
    throw new Error(`Unknown credential encryption scheme on row ${row.credential_id}.`);
  }
  return row.encryption_scheme;
}

/**
 * Per-item ACL decision for a single native credential (the correctness path
 * for single-record operations — list uses the SQL scope path instead).
 *
 * Restricted rows are visible only to the owner / explicitly granted users or
 * teams; an unauthorized restricted row must behave as absent (the caller
 * throws CREDENTIAL_NOT_FOUND / returns null) so existence is never
 * confirmed — otherwise any credential:update holder could un-restrict a
 * credential they cannot see and then reveal it.
 */
async function isCredentialAuthorizedForUser(
  trx: Knex.Transaction,
  ctx: CredentialSourceContext,
  row: CredentialRowProjection
): Promise<boolean> {
  const grants = await fetchGrantsForCredential(trx, ctx.tenant, row.credential_id);
  const authContext = await createCredentialAuthorizationContext(trx, ctx.tenant, ctx.user);
  return authorizeCredentialRecord(trx, authContext, row, grants);
}

function notFound(): never {
  throw Object.assign(new Error('Credential not found'), { code: 'CREDENTIAL_NOT_FOUND' });
}

/**
 * Field names that changed in an update — names only, never values. Secret-
 * bearing fields record only the fact of change (the caller provided them),
 * which is itself audit-worthy ("the password was rotated") and value-free.
 */
function changedFieldsForUpdate(
  input: Partial<CredentialWriteInput>,
  existing: CredentialRowProjection
): string[] {
  const changed: string[] = [];
  if (input.name !== undefined && input.name.trim() !== existing.name) changed.push('name');
  if (input.username !== undefined && (input.username || null) !== existing.username) changed.push('username');
  if (input.password !== undefined) changed.push('password');
  if (input.otpSecret !== undefined) changed.push('otp_secret');
  if (input.url !== undefined && (input.url || null) !== existing.url) changed.push('url');
  if (input.description !== undefined && (input.description || null) !== existing.description) {
    changed.push('description');
  }
  if (input.clientId !== undefined && input.clientId !== existing.client_id) changed.push('client_id');
  return changed;
}

function applyListFilters(
  builder: Knex.QueryBuilder,
  filter: CredentialListFilter,
  userId: string
): Knex.QueryBuilder {
  const term = filter.search?.trim();
  if (term) {
    builder.andWhere(function search(this: Knex.QueryBuilder) {
      this.whereILike('cr.name', `%${term}%`);
      this.orWhereILike('cr.username', `%${term}%`);
      this.orWhereILike('cr.url', `%${term}%`);
    });
  }
  if (filter.clientId) {
    builder.andWhere('cr.client_id', filter.clientId);
  }
  if (filter.entityType && filter.entityId) {
    builder.andWhere(function entityScope(this: Knex.QueryBuilder) {
      this.whereExists(function existsEntity(this: Knex.QueryBuilder) {
        this.select(1)
          .from('credential_associations as ca')
          .whereRaw('ca.tenant = cr.tenant')
          .whereRaw('ca.credential_id = cr.credential_id')
          .where('ca.entity_type', filter.entityType)
          .where('ca.entity_id', filter.entityId);
      });
    });
  }
  return builder;
}

async function authorizeRows(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  rows: CredentialRowProjection[]
): Promise<CredentialRowProjection[]> {
  if (rows.length === 0) return rows;
  const context = await createCredentialAuthorizationContext(trx, tenant, user);
  const grantsByCredential = await loadGrants(
    trx,
    tenant,
    rows.map((row) => row.credential_id)
  );
  const decisions = await Promise.all(
    rows.map((row) =>
      authorizeCredentialRecord(
        trx,
        context,
        row,
        grantsByCredential.get(row.credential_id) ?? []
      )
    )
  );
  return rows.filter((_, index) => decisions[index]);
}

export class NativeCredentialSource implements CredentialSource {
  readonly kind = 'alga' as const;

  async list(ctx: CredentialSourceContext, filter: CredentialListFilter): Promise<CredentialSummary[]> {
    const { knex } = await createTenantKnex(ctx.tenant);
    const rows = await withTransaction(knex, async (trx) => {
      const authContext = await createCredentialAuthorizationContext(trx, ctx.tenant, ctx.user);
      const query = tenantDb(trx, ctx.tenant).scoped('credentials as cr');
      applyListFilters(query.builder, filter, ctx.userId);
      const scope = compileCredentialReadScopeSql(query, authContext);
      if (!scope.supported) {
        // Bundle rule not representable in SQL — fall back to the JS kernel
        // over the full filtered set (correctness over performance).
        const allRows = await query.builder.clone().select<CredentialRowProjection[]>('cr.*').orderBy('cr.name', 'asc');
        return authorizeRows(trx, ctx.tenant, ctx.user, allRows);
      }
      return query.builder.select<CredentialRowProjection[]>('cr.*').orderBy('cr.name', 'asc');
    });

    if (rows.length === 0) return [];
    const clientNames = await loadClientNames(
      knex,
      ctx.tenant,
      rows.map((row) => row.client_id)
    );
    const associations = await loadAssociations(
      knex,
      ctx.tenant,
      rows.map((row) => row.credential_id)
    );
    return rows.map((row) =>
      toSummary(row, clientNames.get(row.client_id) ?? null, associations.get(row.credential_id) ?? [])
    );
  }

  /**
   * Authorized batch fetch by ids, preserving input order. Used by the
   * association-driven entity lists: restricted rows the caller cannot see
   * are omitted (the association row stays; it is only a read-time hiding).
   */
  async listByIds(ctx: CredentialSourceContext, ids: string[]): Promise<CredentialSummary[]> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return [];
    const { knex } = await createTenantKnex(ctx.tenant);
    const rows = await withTransaction(knex, async (trx) => {
      const authContext = await createCredentialAuthorizationContext(trx, ctx.tenant, ctx.user);
      const query = tenantDb(trx, ctx.tenant).scoped('credentials as cr');
      query.builder.whereIn('cr.credential_id', unique);
      const scope = compileCredentialReadScopeSql(query, authContext);
      if (!scope.supported) {
        const allRows = await query.builder
          .clone()
          .select<CredentialRowProjection[]>('cr.*')
          .whereIn('cr.credential_id', unique);
        return authorizeRows(trx, ctx.tenant, ctx.user, allRows);
      }
      return query.builder.select<CredentialRowProjection[]>('cr.*').whereIn('cr.credential_id', unique);
    });
    if (rows.length === 0) return [];
    const clientNames = await loadClientNames(
      knex,
      ctx.tenant,
      rows.map((row) => row.client_id)
    );
    const associations = await loadAssociations(
      knex,
      ctx.tenant,
      rows.map((row) => row.credential_id)
    );
    const byId = new Map(rows.map((row) => [row.credential_id, row]));
    return unique.flatMap((id) => {
      const row = byId.get(id);
      return row
        ? [toSummary(row, clientNames.get(row.client_id) ?? null, associations.get(row.credential_id) ?? [])]
        : [];
    });
  }

  /**
   * Owning client for a native credential, exposed only to callers the kernel
   * authorizes. Returns null (never throws) when the row is absent OR the
   * caller cannot see it — indistinguishable to avoid an existence leak — so
   * association writes fail closed as not-found.
   */
  async resolveOwnerClientId(ctx: CredentialSourceContext, id: string): Promise<string | null> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      const row = await fetchCredentialById(trx, ctx.tenant, id);
      if (!row) return null;
      const grants = await fetchGrantsForCredential(trx, ctx.tenant, id);
      const allowed = await authorizeCredentialRecord(
        trx,
        await createCredentialAuthorizationContext(trx, ctx.tenant, ctx.user),
        row,
        grants
      );
      return allowed ? row.client_id : null;
    });
  }

  /** Metadata + grants for one native credential (RBAC checked by the action). */
  async getDetail(ctx: CredentialSourceContext, id: string): Promise<CredentialDetail | null> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      const row = await fetchCredentialById(trx, ctx.tenant, id);
      if (!row) return null;
      const grants = await fetchGrantsForCredential(trx, ctx.tenant, id);
      const allowed = await authorizeCredentialRecord(
        trx,
        await createCredentialAuthorizationContext(trx, ctx.tenant, ctx.user),
        row,
        grants
      );
      // Restricted rows are hidden entirely: an unauthorized caller must not
      // learn the row exists, its metadata, or its grant list.
      if (!allowed) return null;
      const [associations, clientName] = await Promise.all([
        loadAssociations(trx, ctx.tenant, [id]),
        (async () => {
          const names = await loadClientNames(trx, ctx.tenant, [row.client_id]);
          return names.get(row.client_id) ?? null;
        })(),
      ]);
      return {
        ...toSummary(row, clientName, associations.get(id) ?? []),
        grants: grants.map((g) => ({ subjectType: g.subject_type, subjectId: g.subject_id })),
      };
    });
  }

  async reveal(ctx: CredentialSourceContext, id: string): Promise<CredentialRevealResult> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      const row = await fetchCredentialById(trx, ctx.tenant, id);
      if (!row) return { state: 'not_found' };
      const grants = await fetchGrantsForCredential(trx, ctx.tenant, id);
      const allowed = await authorizeCredentialRecord(trx, await createCredentialAuthorizationContext(trx, ctx.tenant, ctx.user), row, grants);
      if (!allowed) return { state: 'no_access' };

      // Fail-closed audit: written in the same transaction BEFORE any value is
      // decrypted/returned; a failed audit throws and nothing is returned.
      await writeCredentialAudit(trx, ctx.tenant, 'credential_reveal', {
        userId: ctx.userId,
        credentialId: row.credential_id,
        clientId: row.client_id,
      });

      const scheme = requireScheme(row);
      const password = row.password_ciphertext
        ? await decryptCredentialValue(row.password_ciphertext, scheme)
        : null;

      let otpCode: CredentialRevealResult['otpCode'] = null;
      if (row.otp_secret_ciphertext) {
        const seed = await decryptCredentialValue(row.otp_secret_ciphertext, scheme);
        if (seed) {
          otpCode = generateTotp(seed);
        }
      }

      return { state: 'ok', password: password ?? '', otpCode };
    });
  }

  async revealOtpSeed(ctx: CredentialSourceContext, id: string): Promise<CredentialRevealResult> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      const row = await fetchCredentialById(trx, ctx.tenant, id);
      if (!row) return { state: 'not_found' };
      const grants = await fetchGrantsForCredential(trx, ctx.tenant, id);
      const allowed = await authorizeCredentialRecord(trx, await createCredentialAuthorizationContext(trx, ctx.tenant, ctx.user), row, grants);
      if (!allowed) return { state: 'no_access' };
      if (!row.otp_secret_ciphertext) return { state: 'ok', password: null, otpCode: null };

      await writeCredentialAudit(trx, ctx.tenant, 'credential_otp_seed_reveal', {
        userId: ctx.userId,
        credentialId: row.credential_id,
        clientId: row.client_id,
      });

      const scheme = requireScheme(row);
      const seed = await decryptCredentialValue(row.otp_secret_ciphertext, scheme);
      return { state: 'ok', password: seed, otpCode: null };
    });
  }

  async create(ctx: CredentialSourceContext, input: CredentialWriteInput): Promise<CredentialSummary> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      const otpSecret = input.otpSecret ? normalizeOtpSecret(input.otpSecret) : null;
      const encrypted = await encryptCredentialValues({
        password: input.password ?? null,
        otpSecret,
      });

      const [row] = await tenantDb(trx, ctx.tenant)
        .table<CredentialRowProjection>('credentials')
        .insert({
          tenant: ctx.tenant,
          client_id: input.clientId,
          name: input.name.trim(),
          username: input.username ?? null,
          url: input.url ?? null,
          description: input.description ?? null,
          password_ciphertext: encrypted.passwordCiphertext,
          otp_secret_ciphertext: encrypted.otpSecretCiphertext,
          encryption_scheme: encrypted.scheme,
          is_restricted: false,
          created_by: ctx.userId,
        })
        .returning('*');

      if (input.attachments?.length) {
        await associateCredentialWithEntities(trx, ctx.tenant, row.credential_id, input.attachments);
      }

      await writeCredentialAudit(trx, ctx.tenant, 'credential_created', {
        userId: ctx.userId,
        credentialId: row.credential_id,
        clientId: input.clientId,
      });

      return toSummary(row, null, input.attachments ?? []);
    });
  }

  async update(
    ctx: CredentialSourceContext,
    id: string,
    input: Partial<CredentialWriteInput>
  ): Promise<CredentialSummary> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      // FOR UPDATE from the first statement: the reassignment same-client
      // check below must observe committed state and hold the row lock so a
      // concurrent association write (associations.ts takes the same lock)
      // cannot commit between the check and our own update.
      const existing = await fetchCredentialById(trx, ctx.tenant, id, true);
      if (!existing) notFound();
      if (!(await isCredentialAuthorizedForUser(trx, ctx, existing))) notFound();

      const patch: Partial<CredentialRowProjection> = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.username !== undefined) patch.username = input.username || null;
      if (input.url !== undefined) patch.url = input.url || null;
      if (input.description !== undefined) patch.description = input.description || null;

      // Value-bearing fields: re-encrypt under the current write scheme. When
      // either field changes, BOTH ciphertexts are re-encrypted together and
      // BOTH are written back — the unchanged field's fresh ciphertext must
      // not be discarded, or it would keep old-scheme bytes under the new
      // scheme tag and become undecryptable (e.g. transit configured after the
      // row was written with aes-256-gcm:v1).
      const reencryptPassword = input.password !== undefined;
      const reencryptOtp = input.otpSecret !== undefined;
      if (reencryptPassword || reencryptOtp) {
        const nextOtpSecret = reencryptOtp
          ? input.otpSecret
            ? normalizeOtpSecret(input.otpSecret)
            : null
          : existing.otp_secret_ciphertext
            ? await decryptCredentialValue(existing.otp_secret_ciphertext, requireScheme(existing))
            : null;
        const encrypted = await encryptCredentialValues({
          password: reencryptPassword ? (input.password ?? null) : (existing.password_ciphertext ? await decryptCredentialValue(existing.password_ciphertext, requireScheme(existing)) : null),
          otpSecret: nextOtpSecret,
        });
        patch.password_ciphertext = encrypted.passwordCiphertext;
        patch.otp_secret_ciphertext = encrypted.otpSecretCiphertext;
        patch.encryption_scheme = encrypted.scheme;
      }

      if (input.clientId !== undefined && input.clientId !== existing.client_id) {
        // Ownership reassignment: the same-client invariant create and
        // setAssociations already enforce must hold here too. Reject before any
        // patch is applied (inside the transaction) when a client-bound
        // association resolves to a different client than the proposed one —
        // otherwise this path would silently orphan associations across clients.
        const associations = await loadAssociations(trx, ctx.tenant, [id]);
        await assertAttachmentsMatchClient(trx, ctx.tenant, associations.get(id) ?? [], input.clientId);
        patch.client_id = input.clientId;
      }
      patch.updated_at = knex.fn.now() as unknown as string;

      const [row] = await tenantDb(trx, ctx.tenant)
        .table<CredentialRowProjection>('credentials')
        .where('credential_id', id)
        .update(patch)
        .returning('*');

      await writeCredentialAudit(trx, ctx.tenant, 'credential_updated', {
        userId: ctx.userId,
        credentialId: id,
        clientId: input.clientId ?? existing.client_id,
      }, { changed_fields: changedFieldsForUpdate(input, existing) });

      const associations = await loadAssociations(trx, ctx.tenant, [id]);
      return toSummary(row, null, associations.get(id) ?? []);
    });
  }

  async remove(ctx: CredentialSourceContext, id: string): Promise<void> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      const existing = await fetchCredentialById(trx, ctx.tenant, id);
      if (!existing) notFound();
      if (!(await isCredentialAuthorizedForUser(trx, ctx, existing))) notFound();
      const grants = await fetchGrantsForCredential(trx, ctx.tenant, id);
      await tenantDb(trx, ctx.tenant).table('credentials').where('credential_id', id).del();
      await writeCredentialAudit(trx, ctx.tenant, 'credential_deleted', {
        userId: ctx.userId,
        credentialId: id,
        clientId: existing.client_id,
      }, {
        // Value-free authorization snapshot so the audit reader can keep
        // showing this credential's history after the row is gone — and hide
        // it from viewers who could not have read it while it existed.
        credential_scope: {
          is_restricted: existing.is_restricted === true,
          created_by: existing.created_by,
          client_id: existing.client_id,
          grants: grants.map((grant) => ({
            subject_type: grant.subject_type,
            subject_id: grant.subject_id,
          })),
        },
      });
    });
  }

  /** Replace the grant list (restricted credential). Persists an audit row. */
  async setRestriction(
    ctx: CredentialSourceContext,
    id: string,
    input: { isRestricted: boolean; grants: CredentialGrant[] }
  ): Promise<CredentialDetail> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      const existing = await fetchCredentialById(trx, ctx.tenant, id);
      if (!existing) notFound();
      // Item-level ACL first: a caller who cannot see this restricted row must
      // not be able to un-restrict it (which would defeat the restriction).
      if (!(await isCredentialAuthorizedForUser(trx, ctx, existing))) notFound();
      // Snapshot the grants BEFORE the replace so the audit records the delta.
      const existingGrants = await fetchGrantsForCredential(trx, ctx.tenant, id);
      await tenantDb(trx, ctx.tenant)
        .table('credentials')
        .where('credential_id', id)
        .update({ is_restricted: input.isRestricted, updated_at: knex.fn.now() });

      await tenantDb(trx, ctx.tenant).table('credential_access_grants').where('credential_id', id).del();
      const uniqueGrants = Array.from(
        new Map(
          input.grants.map((g) => [`${g.subjectType}:${g.subjectId}`, g])
        ).values()
      );
      if (uniqueGrants.length > 0) {
        await tenantDb(trx, ctx.tenant)
          .table('credential_access_grants')
          .insert(
            uniqueGrants.map((grant) => ({
              tenant: ctx.tenant,
              credential_id: id,
              subject_type: grant.subjectType,
              subject_id: grant.subjectId,
              created_by: ctx.userId,
            }))
          );
      }

      const existingGrantKeys = new Set(existingGrants.map((g) => `${g.subject_type}:${g.subject_id}`));
      const newGrantKeys = new Set(uniqueGrants.map((g) => `${g.subjectType}:${g.subjectId}`));
      const grantsAdded = Array.from(newGrantKeys).filter((key) => !existingGrantKeys.has(key)).length;
      const grantsRemoved = Array.from(existingGrantKeys).filter((key) => !newGrantKeys.has(key)).length;

      await writeCredentialAudit(trx, ctx.tenant, 'credential_grants_changed', {
        userId: ctx.userId,
        credentialId: id,
        clientId: existing.client_id,
      }, { grants_added: grantsAdded, grants_removed: grantsRemoved });

      const grants = await fetchGrantsForCredential(trx, ctx.tenant, id);
      return {
        ...toSummary({ ...existing, is_restricted: input.isRestricted }, null, []),
        grants: grants.map((g) => ({ subjectType: g.subject_type, subjectId: g.subject_id })),
      };
    });
  }

  /** Replace the full attachment set for a native credential. Persists an audit row. */
  async setAssociations(
    ctx: CredentialSourceContext,
    id: string,
    input: { attachments: CredentialAttachment[] }
  ): Promise<CredentialSummary> {
    const { knex } = await createTenantKnex(ctx.tenant);
    return withTransaction(knex, async (trx) => {
      const existing = await fetchCredentialById(trx, ctx.tenant, id);
      if (!existing) notFound();
      if (!(await isCredentialAuthorizedForUser(trx, ctx, existing))) notFound();
      const attachments = Array.from(
        new Map(input.attachments.map((a) => [`${a.entityType}:${a.entityId}`, a])).values()
      );
      await tenantDb(trx, ctx.tenant)
        .table('credential_associations')
        .where('credential_id', id)
        .del();
      if (attachments.length > 0) {
        await associateCredentialWithEntities(trx, ctx.tenant, id, attachments);
      }
      await writeCredentialAudit(trx, ctx.tenant, 'credential_updated', {
        userId: ctx.userId,
        credentialId: id,
        clientId: existing.client_id,
      });
      return toSummary(existing, null, attachments);
    });
  }
}

async function associateCredentialWithEntities(
  trx: Knex.Transaction,
  tenant: string,
  credentialId: string,
  attachments: CredentialAttachment[]
): Promise<void> {
  const unique = Array.from(
    new Map(attachments.map((a) => [`${a.entityType}:${a.entityId}`, a])).values()
  );
  if (unique.length === 0) return;
  const existing = await tenantDb(trx, tenant)
    .table<{ entity_id: string; entity_type: string }>('credential_associations')
    .where('credential_id', credentialId)
    .whereIn(
      'entity_type',
      Array.from(new Set(unique.map((a) => a.entityType)))
    )
    .select('entity_id', 'entity_type');
  const existingKeys = new Set(existing.map((row) => `${row.entity_type}:${row.entity_id}`));
  const toInsert = unique.filter((a) => !existingKeys.has(`${a.entityType}:${a.entityId}`));
  if (toInsert.length > 0) {
    await tenantDb(trx, tenant)
      .table('credential_associations')
      .insert(
        toInsert.map((a) => ({
          tenant,
          credential_id: credentialId,
          entity_id: a.entityId,
          entity_type: a.entityType,
        }))
      );
  }
}

export const nativeCredentialSource: NativeCredentialSource = new NativeCredentialSource();
