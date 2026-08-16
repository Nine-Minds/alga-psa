import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * The one place a client's default billing profile gets provisioned.
 *
 * Every client must have exactly one default billing profile: it is step 5 of
 * the charge-attribution chain and the reason the chain always terminates. The
 * S1 migration backfills one for every client that existed at migration time;
 * this covers every client created since.
 *
 * It lives in `shared/` rather than in the billing package because the callers
 * that need it are on the *client* side — the client actions, the public API
 * client service, CSV import, onboarding — and none of them should take a
 * dependency on the billing engine to satisfy a billing invariant.
 *
 * Provisioning is idempotent and race-safe: the partial unique index on
 * `(tenant, client_id) WHERE is_default` settles concurrent attempts, and the
 * loser reads the winner's row rather than creating a second default.
 */

export const CLIENT_BILLING_PROFILES_TABLE = 'client_billing_profiles';

async function readDefaultProfileId(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<string | undefined> {
  const row = await tenantDb(knex, tenant)
    .table(CLIENT_BILLING_PROFILES_TABLE)
    .where({ client_id: clientId, is_default: true })
    .select('billing_profile_id')
    .first();
  return row?.billing_profile_id as string | undefined;
}

export async function ensureClientDefaultBillingProfile(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  options?: { clientName?: string | null },
): Promise<string> {
  const existing = await readDefaultProfileId(knex, tenant, clientId);
  if (existing) return existing;

  const db = tenantDb(knex, tenant);
  let name = options?.clientName ?? null;
  if (!name) {
    const client = await db
      .table('clients')
      .where({ client_id: clientId })
      .select('client_name')
      .first();
    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${tenant}.`);
    }
    name = client.client_name as string;
  }

  try {
    const [inserted] = await db.table(CLIENT_BILLING_PROFILES_TABLE).insert(
      {
        tenant,
        client_id: clientId,
        name,
        is_default: true,
        // Marks the profile as one the system created rather than one a user
        // authored, exactly as the system-managed default contract does.
        is_system_managed_default: true,
        is_active: true,
      },
      ['billing_profile_id'],
    );
    if (inserted?.billing_profile_id) {
      return inserted.billing_profile_id as string;
    }
  } catch (error) {
    const raced = await readDefaultProfileId(knex, tenant, clientId);
    if (raced) return raced;
    throw error;
  }

  const settled = await readDefaultProfileId(knex, tenant, clientId);
  if (!settled) {
    throw new Error(
      `Client ${clientId} has no default billing profile in tenant ${tenant} and one could not be provisioned.`,
    );
  }
  return settled;
}
