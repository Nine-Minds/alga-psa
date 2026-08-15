/**
 * Credential association service (EE-only).
 *
 * The entity-attachments stack for credentials, shaped like
 * document_associations + Documents.tsx but credential-specific: an
 * association row carries either a native `credential_id` or a Hudu
 * `credential_ref` (exactly one — enforced by the DB CHECK), and entity lists
 * are association-driven for BOTH sources.
 *
 * // LEVERAGE: pattern entity-attachments — documents (documentActions.ts +
 * // Documents.tsx) and credentials (this module + the per-entity section
 * // embeds) both implement the same "polymorphic join table keyed by
 * // (tenant, entity_id, entity_type)" stack. Extracting a shared
 * // entity-attachments engine and re-basing both is a dedicated follow-up
 * // card; this card mirrors the pattern deliberately (see plan §scope
 * // expansion, decision 2).
 *
 * Same-client enforcement: for the six client-bound entity types (ticket,
 * asset, contact, contract, project_task, quote) a write resolves the
 * entity's owning client and rejects a mismatch with the credential's owning
 * client (for Hudu refs, the mapped client must match). Clientless types
 * (document, team, tenant, user) attach unconstrained.
 */

import type { Knex } from 'knex';
import type {
  CredentialAssociationEntityType,
  CredentialAttachment,
  CredentialReplaceBaseline,
  CredentialSourceContext,
} from './contracts';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTenantKnex } from 'server/src/lib/db';
import { isHuduCredentialId, huduCredentialSource } from './huduSource';
import { nativeCredentialSource } from './nativeSource';
import { writeCredentialAudit } from './audit';

/** Entity types whose owning client must match the credential's owning client. */
export const CLIENT_BOUND_ENTITY_TYPES: ReadonlySet<CredentialAssociationEntityType> = new Set([
  'ticket',
  'asset',
  'contact',
  'contract',
  'project_task',
  'quote',
]);

export interface CredentialAssociationRow {
  association_id: string;
  credential_id: string | null;
  credential_ref: string | null;
  entity_id: string;
  entity_type: string;
}

/**
 * Serialize association mutations against concurrent ownership reassignment on
 * the SAME native credential. Takes FOR UPDATE row locks on every native
 * credential the mutation touches (deterministic order — no deadlock) so the
 * owner-client resolution and same-client checks below always observe the
 * credential's committed, post-commit state. The reassignment path
 * (nativeSource.update) takes the same row lock, so the two serialize: either
 * the attach sees the post-reassign owner and rejects a mismatched entity, or
 * the reassign sees the post-attach association list and rejects the move.
 *
 * Hudu refs have no native row to lock; their owning client derives from the
 * company mapping, which the reassignment path never mutates.
 */
async function lockCredentialRowsForWrite(
  trx: Knex.Transaction,
  tenant: string,
  credentialIds: string[]
): Promise<void> {
  const nativeIds = Array.from(new Set(credentialIds.filter((id) => !isHuduCredentialId(id)))).sort();
  if (nativeIds.length === 0) return;
  await tenantDb(trx, tenant)
    .table('credentials')
    .whereIn('credential_id', nativeIds)
    .forUpdate()
    .select('credential_id');
}

function notFound(): never {
  throw Object.assign(new Error('Credential not found'), { code: 'CREDENTIAL_NOT_FOUND' });
}

function clientMismatch(entityType: string): never {
  throw Object.assign(
    new Error(
      `Credential cannot be attached to this ${entityType}: it belongs to a different client.`
    ),
    { code: 'CREDENTIAL_CLIENT_MISMATCH' }
  );
}

/**
 * Owning client of an entity, resolved from the entity's own table. Returns
 * null for clientless types (attach unconstrained) and for entities that have
 * no owning client (nothing to mismatch against).
 */
export async function resolveEntityClientId(
  trx: Knex | Knex.Transaction,
  tenant: string,
  entityType: CredentialAssociationEntityType,
  entityId: string
): Promise<string | null> {
  const db = tenantDb(trx, tenant);
  switch (entityType) {
    case 'ticket': {
      const row = await db.table('tickets').where('ticket_id', entityId).select('client_id').first();
      return row?.client_id ?? null;
    }
    case 'asset': {
      const row = await db.table('assets').where('asset_id', entityId).select('client_id').first();
      return row?.client_id ?? null;
    }
    case 'contact': {
      const row = await db.table('contacts').where('contact_name_id', entityId).select('client_id').first();
      return row?.client_id ?? null;
    }
    case 'contract': {
      const row = await db.table('client_contracts').where('contract_id', entityId).select('client_id').first();
      return row?.client_id ?? null;
    }
    case 'project_task': {
      // The task's owning client is indirect: task -> phase -> project.
      const row = await db
        .table('project_tasks as pt')
        .modify((builder) => {
          db.tenantJoin(builder, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id');
          db.tenantJoin(builder, 'projects as p', 'pp.project_id', 'p.project_id');
        })
        .where('pt.task_id', entityId)
        .select('p.client_id')
        .first();
      return row?.client_id ?? null;
    }
    case 'quote': {
      const row = await db.table('quotes').where('quote_id', entityId).select('client_id').first();
      return row?.client_id ?? null;
    }
    default:
      // document / team / tenant / user (and `client` — parity only, no UI
      // writes it this card) attach unconstrained.
      return null;
  }
}

export async function loadAssociationsForEntity(
  trx: Knex | Knex.Transaction,
  tenant: string,
  entityType: CredentialAssociationEntityType,
  entityId: string
): Promise<CredentialAssociationRow[]> {
  return tenantDb(trx, tenant)
    .table<CredentialAssociationRow>('credential_associations')
    .where('entity_type', entityType)
    .where('entity_id', entityId)
    .select('association_id', 'credential_id', 'credential_ref', 'entity_id', 'entity_type');
}

/** Owning client of the credential (both sources), null when the caller cannot see it. */
async function resolveCredentialOwnerClientId(
  ctx: CredentialSourceContext,
  credentialId: string
): Promise<string | null> {
  return isHuduCredentialId(credentialId)
    ? huduCredentialSource.resolveOwnerClientId(ctx, credentialId)
    : nativeCredentialSource.resolveOwnerClientId(ctx, credentialId);
}

function assertSameClient(
  trx: Knex.Transaction,
  tenant: string,
  entityType: CredentialAssociationEntityType,
  entityId: string,
  credentialClientId: string
): Promise<void> {
  if (!CLIENT_BOUND_ENTITY_TYPES.has(entityType)) return Promise.resolve();
  return resolveEntityClientId(trx, tenant, entityType, entityId).then((entityClientId) => {
    if (entityClientId && entityClientId !== credentialClientId) {
      clientMismatch(entityType);
    }
  });
}

/**
 * Enforce the same-client rule for EXISTING association rows against a
 * proposed owning client. Ownership reassignment (nativeSource.update) must
 * hold to the same invariant create and setAssociations enforce: every
 * client-bound attachment must resolve to the proposed client, else the write
 * is rejected. Clientless types never block. The entity->owning-client
 * resolution is the shared `resolveEntityClientId`, not a re-derivation.
 */
export async function assertAttachmentsMatchClient(
  trx: Knex.Transaction,
  tenant: string,
  attachments: CredentialAttachment[],
  proposedClientId: string
): Promise<void> {
  for (const attachment of attachments) {
    if (!CLIENT_BOUND_ENTITY_TYPES.has(attachment.entityType)) continue;
    const entityClientId = await resolveEntityClientId(trx, tenant, attachment.entityType, attachment.entityId);
    if (entityClientId && entityClientId !== proposedClientId) {
      clientMismatch(attachment.entityType);
    }
  }
}

async function insertAssociation(
  trx: Knex.Transaction,
  tenant: string,
  entityType: CredentialAssociationEntityType,
  entityId: string,
  credentialId: string
): Promise<void> {
  const row = isHuduCredentialId(credentialId)
    ? { tenant, credential_ref: credentialId, entity_id: entityId, entity_type: entityType }
    : { tenant, credential_id: credentialId, entity_id: entityId, entity_type: entityType };
  await tenantDb(trx, tenant).table('credential_associations').insert(row);
}

/** Attach one credential to an entity. Same-client enforced for bound types. */
export async function addCredentialToEntity(
  ctx: CredentialSourceContext,
  entityType: CredentialAssociationEntityType,
  entityId: string,
  credentialId: string
): Promise<void> {
  const { knex } = await createTenantKnex(ctx.tenant);
  await withTransaction(knex, async (trx) => {
    // Hold the credential row lock for the whole mutation so a concurrent
    // reassignment cannot commit between our owner-client read and the insert.
    await lockCredentialRowsForWrite(trx, ctx.tenant, [credentialId]);
    // The credential's owning client (both sources), with the caller's
    // authorization baked in: absent or invisible => fail closed as not-found.
    const ownerClientId = await resolveCredentialOwnerClientId(ctx, credentialId);
    if (!ownerClientId) notFound();
    await assertSameClient(trx, ctx.tenant, entityType, entityId, ownerClientId);

    await insertAssociation(trx, ctx.tenant, entityType, entityId, credentialId);

    await writeCredentialAudit(trx, ctx.tenant, 'credential_associated', {
      userId: ctx.userId,
      credentialId,
      clientId: ownerClientId,
    }, { entity_type: entityType, entity_id: entityId });
  });
}

/** Detach one credential from an entity. */
export async function removeCredentialFromEntity(
  ctx: CredentialSourceContext,
  entityType: CredentialAssociationEntityType,
  entityId: string,
  credentialId: string
): Promise<void> {
  const { knex } = await createTenantKnex(ctx.tenant);
  await withTransaction(knex, async (trx) => {
    await lockCredentialRowsForWrite(trx, ctx.tenant, [credentialId]);
    const ownerClientId = await resolveCredentialOwnerClientId(ctx, credentialId);
    if (!ownerClientId) notFound();

    const query = tenantDb(trx, ctx.tenant)
      .table('credential_associations')
      .where('entity_type', entityType)
      .where('entity_id', entityId);
    if (isHuduCredentialId(credentialId)) {
      await query.where('credential_ref', credentialId).del();
    } else {
      await query.where('credential_id', credentialId).del();
    }

    await writeCredentialAudit(trx, ctx.tenant, 'credential_detached', {
      userId: ctx.userId,
      credentialId,
      clientId: ownerClientId,
    }, { entity_type: entityType, entity_id: entityId });
  });
}

/**
 * Filter NATIVE association rows down to those whose credential the CALLER is
 * confirmed to see right now. Restricted native credentials are hidden from
 * the caller's list; a row the caller cannot see is preserved: the caller
 * never formed intent about it, and removing one would both leak its existence
 * and destroy it. Batched via listByIds (DB-only kernel scope — no external
 * HTTP), which is what the caller's entity list itself is built from.
 */
async function filterVisibleNativeRows(
  ctx: CredentialSourceContext,
  rows: CredentialAssociationRow[]
): Promise<CredentialAssociationRow[]> {
  const nativeRows = rows.filter((row) => row.credential_id);
  if (nativeRows.length === 0) return [];
  const nativeIds = nativeRows.map((row) => row.credential_id as string);
  const visibleNativeIds = new Set(
    (await nativeCredentialSource.listByIds(ctx, nativeIds)).map((summary) => summary.id)
  );
  return nativeRows.filter((row) => visibleNativeIds.has(row.credential_id as string));
}

/**
 * Replace the full credential set attached to an entity (link-existing save).
 *
 * Removal intent is anchored to the CALLER's rendered snapshot, not to any
 * save-time visibility probe:
 *
 *  - NATIVE rows are removable only when the caller is confirmed to see them
 *    right now (in-transaction kernel filter — DB-only, no external HTTP).
 *  - HUDU refs are removable only when the exact association row the caller
 *    saw (ref + association_id from the `baseline` it renders against) still
 *    exists at mutation time. The delete is keyed to that row identity inside
 *    the transaction. A ref hidden at list load (absent from the baseline) is
 *    preserved even if it would resolve visible at save time, and a row
 *    concurrently reattached under the same ref string (fresh association_id)
 *    is untouched because the stale baseline names the old row.
 *
 * A save invoked WITHOUT a baseline (older callers, CE stubs) is fail-closed:
 * every Hudu ref is preserved, never detached. Confirmed-404 cleanup stays
 * solely on the list/prune path (pruneAssociationRefs); this path never prunes
 * on 404.
 */
export async function setEntityCredentials(
  ctx: CredentialSourceContext,
  entityType: CredentialAssociationEntityType,
  entityId: string,
  credentialIds: string[],
  baseline: CredentialReplaceBaseline[] = []
): Promise<void> {
  const unique = Array.from(new Set(credentialIds));
  const { knex } = await createTenantKnex(ctx.tenant);

  // The caller's rendered snapshot, keyed by the association-row identity each
  // Hudu ref was rendered from. Absent/empty (no baseline) => no Hudu row is
  // removable — the replacement can only ever detach what the caller proves it
  // saw.
  const huduBaselineByAssociationId = new Map(
    baseline.filter((entry) => isHuduCredentialId(entry.ref)).map((entry) => [entry.associationId, entry.ref])
  );

  const desiredKeys = new Set(unique.map((id) => (isHuduCredentialId(id) ? `ref:${id}` : `id:${id}`)));

  await withTransaction(knex, async (trx) => {
    // Lock EVERY native credential the set touches (deterministic order) up
    // front, so a concurrent reassignment of any of them cannot commit between
    // the same-client pre-check and the association diff below.
    await lockCredentialRowsForWrite(trx, ctx.tenant, unique);
    // Resolve + same-client check EVERY credential BEFORE mutating anything so
    // a partial rejection never leaves a half-applied set.
    for (const credentialId of unique) {
      const ownerClientId = await resolveCredentialOwnerClientId(ctx, credentialId);
      if (!ownerClientId) notFound();
      await assertSameClient(trx, ctx.tenant, entityType, entityId, ownerClientId);
    }

    const existing = await loadAssociationsForEntity(trx, ctx.tenant, entityType, entityId);
    const existingKeys = new Set(
      existing.map((row) => (row.credential_id ? `id:${row.credential_id}` : `ref:${row.credential_ref}`))
    );

    // Diff-based application: only rows the caller explicitly omitted AND is
    // PROVEN to have seen are removed. Native rows the caller cannot see
    // survive untouched; Hudu refs survive unless the exact association row the
    // caller's snapshot named still exists and was deliberately omitted.
    const toRemove = existing.filter((row) => {
      const key = row.credential_id ? `id:${row.credential_id}` : `ref:${row.credential_ref}`;
      return !desiredKeys.has(key);
    });

    // Hudu refs: detach ONLY the exact association row the caller saw — its
    // baseline entry must name this row identity AND the same ref. The delete
    // is keyed by association_id inside the transaction, so a reattached row
    // under the same ref string (fresh association_id) is missed untouched.
    const huduToRemove = toRemove.filter(
      (row) => row.credential_ref && huduBaselineByAssociationId.get(row.association_id) === row.credential_ref
    );

    // Native rows: removable only when the caller can see them right now
    // (batched in-transaction kernel filter — DB-only, no external HTTP).
    const nativeVisible = await filterVisibleNativeRows(
      ctx,
      toRemove.filter((row) => row.credential_id)
    );

    // Disjoint by construction: ref rows vs id rows.
    const removable = [...huduToRemove, ...nativeVisible];
    for (const row of removable) {
      const db = tenantDb(trx, ctx.tenant).table('credential_associations');
      if (row.credential_ref) {
        await db
          .where('association_id', row.association_id)
          .where('credential_ref', row.credential_ref)
          .where('entity_type', entityType)
          .where('entity_id', entityId)
          .del();
      } else {
        await db
          .where('credential_id', row.credential_id)
          .where('entity_type', entityType)
          .where('entity_id', entityId)
          .del();
      }
      const credentialId = (row.credential_ref ?? row.credential_id) as string;
      const ownerClientId = await resolveCredentialOwnerClientId(ctx, credentialId);
      await writeCredentialAudit(trx, ctx.tenant, 'credential_detached', {
        userId: ctx.userId,
        credentialId,
        clientId: ownerClientId ?? '',
      }, { entity_type: entityType, entity_id: entityId });
    }

    const toAdd = unique.filter((id) => !existingKeys.has(isHuduCredentialId(id) ? `ref:${id}` : `id:${id}`));
    for (const credentialId of toAdd) {
      await insertAssociation(trx, ctx.tenant, entityType, entityId, credentialId);
      const ownerClientId = await resolveCredentialOwnerClientId(ctx, credentialId);
      await writeCredentialAudit(trx, ctx.tenant, 'credential_associated', {
        userId: ctx.userId,
        credentialId,
        clientId: ownerClientId ?? '',
      }, { entity_type: entityType, entity_id: entityId });
    }
  });
}

/** Lazily prune association rows whose Hudu ref Hudu confirmed gone (404). */
export async function pruneAssociationRefs(
  knex: Knex,
  tenant: string,
  entityType: CredentialAssociationEntityType,
  entityId: string,
  refs: string[]
): Promise<void> {
  const unique = Array.from(new Set(refs));
  if (unique.length === 0) return;
  await tenantDb(knex, tenant)
    .table('credential_associations')
    .where('entity_type', entityType)
    .where('entity_id', entityId)
    .whereIn('credential_ref', unique)
    .del();
}
