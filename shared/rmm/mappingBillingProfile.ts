import type { Knex } from 'knex';
import {
  ASSET_BILLING_PROFILE_UNAVAILABLE,
  assertBillingProfileForClient,
} from '../models/assetBillingProfileModel';

export interface MappingBillingProfileInput {
  /** The mapping's client before the patch. */
  existingClientId: string | null | undefined;
  /** The client the patch sets, or `undefined` when it leaves it alone. */
  nextClientId?: string | null;
  /** The profile the patch sets, or `undefined` when it leaves it alone. */
  billingProfileId?: string | null;
}

/**
 * FR-F1: the billing profile an RMM organization mapping may store.
 *
 * A profile belongs to one client, so two rules hold no matter what else the
 * patch carries: moving the mapping to another client drops the old client's
 * profile, and whatever is chosen has to belong to the mapping's client (after
 * the move) and still be active. Storing the caller's id unchecked let an
 * alert ticket for a device be billed to a profile of a client that no longer
 * owns it.
 *
 * Returns the value to write, or `undefined` when the patch should not touch
 * the column. Throws `ASSET_BILLING_PROFILE_UNAVAILABLE` on a bad choice.
 */
export async function resolveMappingBillingProfileId(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: MappingBillingProfileInput
): Promise<string | null | undefined> {
  const touchesClient = typeof input.nextClientId !== 'undefined';
  const clientChanged =
    touchesClient && String(input.existingClientId ?? '') !== String(input.nextClientId ?? '');
  const chosen = typeof input.billingProfileId === 'undefined' ? undefined : input.billingProfileId || null;

  if (typeof chosen === 'undefined') {
    return clientChanged ? null : undefined;
  }
  if (!chosen) return null;

  const effectiveClientId = touchesClient ? input.nextClientId : input.existingClientId;
  if (!effectiveClientId) {
    throw new Error(ASSET_BILLING_PROFILE_UNAVAILABLE);
  }
  return assertBillingProfileForClient(conn, tenant, String(effectiveClientId), chosen);
}

export { ASSET_BILLING_PROFILE_UNAVAILABLE };
