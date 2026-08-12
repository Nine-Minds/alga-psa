'use server';

/**
 * Credentials vault server actions (EE-only, Pro tier).
 *
 * Gating mirrors huduDataActions: `withAuth` + `hasPermission(user,
 * 'credential', …)` + `assertTierAccess(TIER_FEATURES.CREDENTIALS)`.
 * Per-item ACLs (native rows) are enforced by the authorization kernel inside
 * the native source; Hudu rows are governed by RBAC/tier/bundle scope only.
 *
 * SECURITY: reveal/seed-reveal return transient values and write a fail-closed
 * audit row before returning (no audit ⇒ no value). List payloads are
 * metadata-only. `credential:reveal` is a distinct RBAC action so "can see a
 * row exists" and "can unmask the value" are separately grantable.
 */

import { revalidatePath } from 'next/cache';
import logger from '@alga-psa/core/logger';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import { createTenantKnex } from 'server/src/lib/db';
import { getHuduIntegration } from '../../integrations/hudu/huduIntegrationRepository';
import { getHuduCompanyMappingRows } from '../../integrations/hudu/companyMapping';
import { nativeCredentialSource } from '../../credentials/nativeSource';
import { huduCredentialSource, isHuduCredentialId } from '../../credentials/huduSource';
import {
  addCredentialToEntity as serviceAddCredentialToEntity,
  removeCredentialFromEntity as serviceRemoveCredentialFromEntity,
  setEntityCredentials as serviceSetEntityCredentials,
  loadAssociationsForEntity,
  pruneAssociationRefs,
  resolveEntityClientId,
} from '../../credentials/associations';
import type {
  CredentialAssociationEntityType,
  CredentialDetail,
  CredentialGrant,
  CredentialListFilter,
  CredentialRevealResult,
  CredentialSourceContext,
  CredentialSummary,
  CredentialWriteInput,
} from '../../credentials/contracts';

type CredentialActionPermission = 'create' | 'read' | 'update' | 'delete' | 'reveal';

function withCredentialAccess<TArgs extends unknown[], TResult>(
  requiredPermission: CredentialActionPermission,
  handler: (user: IUserWithRoles, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    if (user.user_type === 'client') {
      throw new Error('Forbidden');
    }

    const allowed = await hasPermission(user, 'credential', requiredPermission);
    if (!allowed) {
      throw new Error(`Forbidden: insufficient permissions (credential ${requiredPermission})`);
    }

    await assertTierAccess(TIER_FEATURES.CREDENTIALS);

    return handler(user, context as { tenant: string }, ...args);
  });
}

function sourceContext(user: IUserWithRoles, tenant: string): CredentialSourceContext {
  return { tenant, userId: user.user_id, user };
}

export type CredentialsContextState = 'ok' | 'tier' | 'forbidden' | 'unavailable';

export interface CredentialsContext {
  tierOk: boolean;
  huduConnected: boolean;
  /** Why the vault is hidden when `tierOk` is false. */
  state: CredentialsContextState;
  /** Kept for symmetry with getHuduClientContext; the release flag is a client concern. */
  flagIrrelevantHere: true;
}

function hiddenContext(state: Exclude<CredentialsContextState, 'ok'>): CredentialsContext {
  return { tierOk: false, huduConnected: false, state, flagIrrelevantHere: true };
}

/**
 * Cheap UI gate for the Passwords nav item / tabs (pattern:
 * getHuduClientContext). Non-throwing: every failure resolves to a hidden
 * state, with `state` saying why so the screen can explain in human terms
 * (tier ⇒ upgrade notice, forbidden ⇒ permission message, unavailable ⇒
 * try-again alert). Deliberately NOT withCredentialAccess: that wrapper
 * throws on tier/permission failures — right for the real actions, but a
 * throw from this probe reaches the client as a generic load error.
 */
export const getCredentialsContext = withAuth(
  async (user, context): Promise<CredentialsContext> => {
    const { tenant } = context as { tenant: string };
    try {
      if (user.user_type === 'client') {
        return hiddenContext('forbidden');
      }
      if (!(await hasPermission(user, 'credential', 'read'))) {
        return hiddenContext('forbidden');
      }
      try {
        await assertTierAccess(TIER_FEATURES.CREDENTIALS);
      } catch (error) {
        if ((error as { code?: string } | null)?.code === 'TIER_ACCESS_DENIED') {
          return hiddenContext('tier');
        }
        throw error;
      }
      const { knex } = await createTenantKnex(tenant);
      const row = await getHuduIntegration(knex, tenant);
      return {
        tierOk: true,
        huduConnected: row?.is_active === true,
        state: 'ok',
        flagIrrelevantHere: true,
      };
    } catch (error) {
      logger.error('[CredentialActions] getCredentialsContext failed', {
        tenant,
        error: error instanceof Error ? error.message : String(error),
      });
      return hiddenContext('unavailable');
    }
  }
);

async function aggregateList(
  user: IUserWithRoles,
  tenant: string,
  filter: CredentialListFilter
): Promise<CredentialSummary[]> {
  const ctx = sourceContext(user, tenant);

  // `sources` is authoritative and lives in the aggregation, not at the call
  // sites. Undefined or empty means "all" (the historical behavior); a
  // non-empty whitelist restricts which backends are even invoked — the
  // deselected backend's `list` is never called and no rows are appended for
  // it. For entity-scoped (association-driven) lists the whitelist composes
  // uniformly: a deselected backend's rows are omitted for that response but
  // never pruned.
  const sourceSet = filter.sources?.length ? new Set(filter.sources) : null;
  const wantNative = sourceSet === null || sourceSet.has('alga');
  const wantHudu = sourceSet === null || sourceSet.has('hudu');

  // Entity-scoped lists are ASSOCIATION-DRIVEN for both sources (the v1
  // "asset lists are native-only" short-circuit is gone): the association rows
  // are loaded, native ids resolve through the native source under its kernel
  // scope, and Hudu refs resolve LIVE through huduSource under the kernel
  // bundle narrowing. A ref Hudu confirms gone (404) is omitted and its
  // association row lazily pruned; transport errors omit the row for this
  // response but never prune.
  if (filter.entityType && filter.entityId) {
    const { knex } = await createTenantKnex(tenant);
    const rows = await loadAssociationsForEntity(knex, tenant, filter.entityType, filter.entityId);

    const nativeIds = rows.flatMap((row) => (row.credential_id ? [row.credential_id] : []));
    const huduRefs = rows.flatMap((row) => (row.credential_ref ? [row.credential_ref] : []));

    const native = wantNative ? await nativeCredentialSource.listByIds(ctx, nativeIds) : [];

    let hudu: CredentialSummary[] = [];
    if (wantHudu && huduRefs.length > 0) {
      const integration = await getHuduIntegration(knex, tenant);
      if (integration?.is_active === true) {
        const resolved = await huduCredentialSource.resolveByIds(ctx, huduRefs);
        const pruneRefs = resolved.filter((r) => r.prune).map((r) => r.ref);
        hudu = resolved.flatMap((r) => (r.summary ? [r.summary] : []));
        if (pruneRefs.length > 0) {
          await pruneAssociationRefs(knex, tenant, filter.entityType, filter.entityId, pruneRefs);
        }
      }
      // Hudu inactive: refs are un-resolvable this response; omit, never prune.
    }
    return [...native, ...hudu];
  }

  if (filter.clientId) {
    // Client-scoped list merges the selected sources for that one client.
    const native = wantNative ? await nativeCredentialSource.list(ctx, filter) : [];
    const hudu = wantHudu ? await huduCredentialSource.list(ctx, filter) : [];
    return [...native, ...hudu];
  }

  // Tenant-wide listing: aggregate every selected source. Hudu rows are
  // company-scoped, so fetch each mapped client's Hudu passwords (bundle
  // scope is enforced per client inside huduSource.list). Only touch Hudu
  // when the integration is actually connected for this tenant.
  const native = wantNative ? await nativeCredentialSource.list(ctx, filter) : [];
  if (!wantHudu) {
    return native;
  }

  const { knex } = await createTenantKnex(tenant);
  const integration = await getHuduIntegration(knex, tenant);
  if (integration?.is_active !== true) {
    return native;
  }
  const mappings = await getHuduCompanyMappingRows(knex, tenant);
  if (mappings.length === 0) {
    return native;
  }

  const huduLists = await Promise.all(
    mappings.map(async (mapping) =>
      huduCredentialSource.list(ctx, { clientId: mapping.alga_entity_id, search: filter.search })
    )
  );
  return [...native, ...huduLists.flat()];
}

export interface ListCredentialsInput {
  clientId?: string;
  /** Entity-scoped list: both must be set together (association-driven). */
  entityType?: CredentialAssociationEntityType;
  entityId?: string;
  search?: string;
  sources?: Array<'alga' | 'hudu'>;
}

export const listCredentials = withCredentialAccess(
  'read',
  async (user, { tenant }, input: ListCredentialsInput = {}): Promise<CredentialSummary[]> => {
    const filter: CredentialListFilter = {
      clientId: input.clientId,
      entityType: input.entityType,
      entityId: input.entityId,
      search: input.search,
      sources: input.sources,
    };
    return aggregateList(user, tenant, filter);
  }
);

export const getCredential = withCredentialAccess(
  'read',
  async (user, { tenant }, id: string): Promise<CredentialDetail | null> => {
    if (isHuduCredentialId(id)) {
      // Hudu rows carry no per-item grants; the client already holds the list
      // summary it needs for editing, and value fetches belong to reveal only.
      return null;
    }
    return nativeCredentialSource.getDetail(sourceContext(user, tenant), id);
  }
);

export interface CreateCredentialInput extends CredentialWriteInput {
  destination: 'alga' | 'hudu';
}

export const createCredential = withCredentialAccess(
  'create',
  async (user, { tenant }, input: CreateCredentialInput): Promise<CredentialSummary> => {
    const { destination, ...write } = input;
    const ctx = sourceContext(user, tenant);

    // Create-preattached same-client enforcement: the new credential's owner
    // is `clientId`; a pre-attached client-bound entity must resolve to that
    // same client, or the write is rejected before anything is created.
    if (write.attachments?.length) {
      await assertAttachmentsSameClient(ctx, write.attachments, write.clientId);
    }

    const summary =
      destination === 'hudu'
        ? await huduCredentialSource.create(ctx, write)
        : await nativeCredentialSource.create(ctx, write);

    // Native creates persist their associations inside the source; Hudu
    // creates know their ref only after the write, so the association rows
    // (credential_ref) are inserted here.
    if (destination === 'hudu' && write.attachments?.length) {
      await attachRefAssociations(ctx, summary.id, write.attachments);
    }

    revalidatePath('/msp/credentials');
    revalidatePath(`/msp/clients/${write.clientId}`);
    return summary;
  }
);

export const updateCredential = withCredentialAccess(
  'update',
  async (user, { tenant }, id: string, input: Partial<CredentialWriteInput>): Promise<CredentialSummary> => {
    const summary = isHuduCredentialId(id)
      ? await huduCredentialSource.update(sourceContext(user, tenant), id, input)
      : await nativeCredentialSource.update(sourceContext(user, tenant), id, input);
    revalidatePath('/msp/credentials');
    if (input.clientId) revalidatePath(`/msp/clients/${input.clientId}`);
    return summary;
  }
);

export const deleteCredential = withCredentialAccess(
  'delete',
  async (user, { tenant }, id: string, clientId?: string): Promise<void> => {
    await (isHuduCredentialId(id)
      ? huduCredentialSource.remove(sourceContext(user, tenant), id)
      : nativeCredentialSource.remove(sourceContext(user, tenant), id));
    revalidatePath('/msp/credentials');
    if (clientId) revalidatePath(`/msp/clients/${clientId}`);
  }
);

export const revealCredential = withCredentialAccess(
  'reveal',
  async (user, { tenant }, id: string): Promise<CredentialRevealResult> => {
    const result = isHuduCredentialId(id)
      ? await huduCredentialSource.reveal(sourceContext(user, tenant), id)
      : await nativeCredentialSource.reveal(sourceContext(user, tenant), id);
    if (result.state === 'ok' && result.password) {
      logger.info('[CredentialActions] credential revealed', {
        tenant,
        credentialId: id,
        source: isHuduCredentialId(id) ? 'hudu' : 'alga',
      });
    }
    return result;
  }
);

export const revealCredentialOtpSeed = withCredentialAccess(
  'reveal',
  async (user, { tenant }, id: string): Promise<CredentialRevealResult> => {
    const result = isHuduCredentialId(id)
      ? await huduCredentialSource.revealOtpSeed(sourceContext(user, tenant), id)
      : await nativeCredentialSource.revealOtpSeed(sourceContext(user, tenant), id);
    if (result.state === 'ok' && result.password) {
      logger.info('[CredentialActions] credential OTP seed revealed', {
        tenant,
        credentialId: id,
        source: isHuduCredentialId(id) ? 'hudu' : 'alga',
      });
    }
    return result;
  }
);

export const setCredentialRestriction = withCredentialAccess(
  'update',
  async (
    user,
    { tenant },
    id: string,
    input: { isRestricted: boolean; grants: CredentialGrant[] }
  ): Promise<CredentialDetail> => {
    if (isHuduCredentialId(id)) {
      throw new Error('Per-credential restrictions are only supported for Alga-native credentials.');
    }
    const detail = await nativeCredentialSource.setRestriction(sourceContext(user, tenant), id, input);
    revalidatePath('/msp/credentials');
    return detail;
  }
);

// ---------------------------------------------------------------------------
// Entity associations (association-driven, both sources)
//
// Associations are managed from the ENTITY side (the credential form shows a
// read-only associations summary). Same-client enforcement is server-side for
// the six client-bound entity types; clientless types attach unconstrained.
// ---------------------------------------------------------------------------

/**
 * Same-client pre-check for create-preattached attachments. The credential
 * owner is the caller-supplied `clientId` (it does not exist yet, so no
 * authorization lookup is needed). Throws CREDENTIAL_CLIENT_MISMATCH when a
 * client-bound entity resolves to a different client.
 */
async function assertAttachmentsSameClient(
  ctx: CredentialSourceContext,
  attachments: { entityType: CredentialAssociationEntityType; entityId: string }[],
  credentialClientId: string
): Promise<void> {
  const { knex } = await createTenantKnex(ctx.tenant);
  const unique = Array.from(
    new Map(attachments.map((a) => [`${a.entityType}:${a.entityId}`, a])).values()
  );
  for (const attachment of unique) {
    const entityClientId = await resolveEntityClientId(knex, ctx.tenant, attachment.entityType, attachment.entityId);
    if (entityClientId && entityClientId !== credentialClientId) {
      throw Object.assign(
        new Error(
          `Credential cannot be attached to this ${attachment.entityType}: it belongs to a different client.`
        ),
        { code: 'CREDENTIAL_CLIENT_MISMATCH' }
      );
    }
  }
}

/** Insert credential_ref association rows for a freshly-created Hudu credential. */
async function attachRefAssociations(
  ctx: CredentialSourceContext,
  credentialRef: string,
  attachments: { entityType: CredentialAssociationEntityType; entityId: string }[]
): Promise<void> {
  const { knex } = await createTenantKnex(ctx.tenant);
  const unique = Array.from(
    new Map(attachments.map((a) => [`${a.entityType}:${a.entityId}`, a])).values()
  );
  if (unique.length === 0) return;
  await knex.transaction(async (trx) => {
    await trx('credential_associations')
      .insert(
        unique.map((a) => ({
          tenant: ctx.tenant,
          credential_ref: credentialRef,
          entity_id: a.entityId,
          entity_type: a.entityType,
        }))
      )
      .onConflict()
      .ignore();
  });
}

/** Attach one credential (native id or Hudu ref) to an entity. */
export const addCredentialToEntity = withCredentialAccess(
  'update',
  async (
    user,
    { tenant },
    entityType: CredentialAssociationEntityType,
    entityId: string,
    credentialId: string
  ): Promise<void> => {
    await serviceAddCredentialToEntity(sourceContext(user, tenant), entityType, entityId, credentialId);
    revalidatePath('/msp/credentials');
  }
);

/** Detach one credential from an entity. */
export const removeCredentialFromEntity = withCredentialAccess(
  'update',
  async (
    user,
    { tenant },
    entityType: CredentialAssociationEntityType,
    entityId: string,
    credentialId: string
  ): Promise<void> => {
    await serviceRemoveCredentialFromEntity(sourceContext(user, tenant), entityType, entityId, credentialId);
    revalidatePath('/msp/credentials');
  }
);

/** Replace the credential set attached to an entity (link-existing save). */
export const setEntityCredentials = withCredentialAccess(
  'update',
  async (
    user,
    { tenant },
    entityType: CredentialAssociationEntityType,
    entityId: string,
    credentialIds: string[]
  ): Promise<void> => {
    await serviceSetEntityCredentials(sourceContext(user, tenant), entityType, entityId, credentialIds);
    revalidatePath('/msp/credentials');
  }
);
