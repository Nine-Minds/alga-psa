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
import type { CredentialAssociationEntityType, CredentialAttachment, CredentialSourceContext } from './contracts';
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
    .select('credential_id', 'credential_ref', 'entity_id', 'entity_type');
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

/** Replace the full credential set attached to an entity (link-existing save). */
export async function setEntityCredentials(
  ctx: CredentialSourceContext,
  entityType: CredentialAssociationEntityType,
  entityId: string,
  credentialIds: string[]
): Promise<void> {
  const unique = Array.from(new Set(credentialIds));
  const { knex } = await createTenantKnex(ctx.tenant);
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
    const desiredKeys = new Set(unique.map((id) => (isHuduCredentialId(id) ? `ref:${id}` : `id:${id}`)));

    const toRemove = existing.filter((row) => {
      const key = row.credential_id ? `id:${row.credential_id}` : `ref:${row.credential_ref}`;
      return !desiredKeys.has(key);
    });
    for (const row of toRemove) {
      const key = row.credential_id ? `id:${row.credential_id}` : `ref:${row.credential_ref}`;
      const db = tenantDb(trx, ctx.tenant).table('credential_associations');
      if (row.credential_id) {
        await db.where('credential_id', row.credential_id).where('entity_type', entityType).where('entity_id', entityId).del();
      } else {
        await db.where('credential_ref', row.credential_ref).where('entity_type', entityType).where('entity_id', entityId).del();
      }
      void key;
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
