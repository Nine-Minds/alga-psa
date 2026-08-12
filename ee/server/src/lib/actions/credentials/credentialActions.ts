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
import type {
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

export interface CredentialsContext {
  tierOk: boolean;
  huduConnected: boolean;
  /** Kept for symmetry with getHuduClientContext; the release flag is a client concern. */
  flagIrrelevantHere: true;
}

/**
 * Cheap UI gate for the Passwords nav item / tabs (pattern:
 * getHuduClientContext). Non-throwing: any failure resolves to a hidden state.
 */
export const getCredentialsContext = withCredentialAccess(
  'read',
  async (_user, { tenant }): Promise<CredentialsContext> => {
    try {
      const { knex } = await createTenantKnex(tenant);
      const row = await getHuduIntegration(knex, tenant);
      return {
        tierOk: true,
        huduConnected: row?.is_active === true,
        flagIrrelevantHere: true,
      };
    } catch (error) {
      logger.error('[CredentialActions] getCredentialsContext failed', {
        tenant,
        error: error instanceof Error ? error.message : String(error),
      });
      return { tierOk: false, huduConnected: false, flagIrrelevantHere: true };
    }
  }
);

async function aggregateList(
  user: IUserWithRoles,
  tenant: string,
  filter: CredentialListFilter
): Promise<CredentialSummary[]> {
  const ctx = sourceContext(user, tenant);
  const native = await nativeCredentialSource.list(ctx, filter);

  if (filter.clientId) {
    const huduRows = await huduCredentialSource.list(ctx, filter);
    return [...native, ...huduRows];
  }

  if (filter.assetId) {
    // Asset-scoped lists are native-only: v1 Hudu rows have no
    // asset-attachment linkage, and fanning out per mapped client would
    // append every mapped company's Hudu passwords to the asset's list.
    return native;
  }

  // Tenant-wide listing: aggregate every selected source. Hudu rows are
  // company-scoped, so fetch each mapped client's Hudu passwords (bundle
  // scope is enforced per client inside huduSource.list). Only touch Hudu
  // when the integration is actually connected for this tenant.
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
  assetId?: string;
  search?: string;
  sources?: Array<'alga' | 'hudu'>;
}

export const listCredentials = withCredentialAccess(
  'read',
  async (user, { tenant }, input: ListCredentialsInput = {}): Promise<CredentialSummary[]> => {
    const filter: CredentialListFilter = {
      clientId: input.clientId,
      assetId: input.assetId,
      search: input.search,
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
    const summary =
      destination === 'hudu'
        ? await huduCredentialSource.create(sourceContext(user, tenant), write)
        : await nativeCredentialSource.create(sourceContext(user, tenant), write);
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

export const setCredentialAssociations = withCredentialAccess(
  'update',
  async (user, { tenant }, id: string, input: { assetIds: string[] }): Promise<CredentialSummary> => {
    if (isHuduCredentialId(id)) {
      throw new Error('Asset attachments are only supported for Alga-native credentials.');
    }
    const summary = await nativeCredentialSource.setAssociations(sourceContext(user, tenant), id, input);
    revalidatePath('/msp/credentials');
    return summary;
  }
);
