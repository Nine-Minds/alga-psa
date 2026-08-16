'use server'

import { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import {
  ensureClientDefaultBillingProfile,
  listClientBillingProfiles,
} from '@alga-psa/shared/billingClients/billingProfiles';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { assertMspPermission } from '../lib/authHelpers';

/**
 * Billing profile CRUD (F035–F041, F044–F048, F052).
 *
 * A billing profile is a billing dimension orthogonal to the client tree: a
 * client may hold several, and contracts, contract lines, locations, tickets,
 * and projects point at one. Every client always has exactly one *default*
 * profile, which is what the charge-attribution chain terminates at — so these
 * actions guard that invariant rather than assuming it.
 */

export type ClientBillingProfileActionError = ActionMessageError | ActionPermissionError;

export interface ClientBillingProfile {
  billing_profile_id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  is_system_managed_default: boolean;
  /** True when charges, contracts, or work items already reference the profile. */
  has_references?: boolean;
}

function billingProfileActionErrorFrom(error: unknown): ClientBillingProfileActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (/unauthorized|not authenticated|must sign in/i.test(error.message)) {
      return permissionError('You must be signed in to manage billing profiles.');
    }
  }

  const dbError = error as { code?: string; message?: string };
  if (dbError?.code === '23505') {
    return actionError('This client already has a default billing profile.');
  }
  if (dbError?.code === '23503') {
    return actionError('The billing profile is still referenced and cannot be removed.');
  }
  // The F002 deferred guard raises a plain exception at COMMIT.
  if (typeof dbError?.message === 'string' && dbError.message.includes('no default profile')) {
    return actionError('A client must always have exactly one default billing profile.');
  }
  return null;
}

const assertCanRead = (user: any) =>
  assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read billing profiles');

const assertCanUpdate = (user: any) =>
  assertMspPermission(user, 'client', 'update', 'Permission denied: Cannot manage billing profiles');

/**
 * Tables that hold a reference to a billing profile, and the column that holds
 * it. Used both to decide whether a profile may be deleted (F041) and to give
 * the user a reason rather than a constraint error.
 */
const PROFILE_REFERENCE_SOURCES: Array<{ table: string; column: string; label: string }> = [
  { table: 'invoice_charges', column: 'billing_profile_id', label: 'invoice charges' },
  { table: 'client_contracts', column: 'billing_profile_id', label: 'contracts' },
  { table: 'contract_lines', column: 'billing_profile_id', label: 'contract lines' },
  { table: 'client_locations', column: 'default_billing_profile_id', label: 'locations' },
  { table: 'tickets', column: 'billing_profile_id', label: 'tickets' },
  { table: 'projects', column: 'billing_profile_id', label: 'projects' },
];

async function referencesToProfile(
  trx: Knex.Transaction,
  tenant: string,
  billingProfileId: string,
): Promise<string[]> {
  const db = tenantDb(trx, tenant);
  const found: string[] = [];
  for (const source of PROFILE_REFERENCE_SOURCES) {
    const row = await db
      .table(source.table)
      .where({ [source.column]: billingProfileId })
      .first(trx.raw('1 as present'));
    if (row) found.push(source.label);
  }
  return found;
}

/**
 * The client's billing profiles, default first.
 *
 * A single-profile client is not segmented, and the D6 invisibility rule keys
 * off exactly that: callers render no profile UI when this returns one row.
 * The default profile is provisioned on demand, so this never returns empty for
 * a client that exists.
 */
export const getClientBillingProfiles = withAuth(async (
  user,
  { tenant },
  clientId: string,
  options?: { includeInactive?: boolean },
): Promise<ClientBillingProfile[] | ClientBillingProfileActionError> => {
  try {
    await assertCanRead(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) =>
      listClientBillingProfiles(trx, tenant, clientId, options));
  } catch (error) {
    const expected = billingProfileActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const createClientBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; name: string },
): Promise<ClientBillingProfile | ClientBillingProfileActionError> => {
  const name = input.name?.trim();
  if (!name) {
    return actionError('A billing profile needs a name.');
  }

  try {
    await assertCanUpdate(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // The first profile a client holds must be the default, or the database
      // guard rejects the commit.
      await ensureClientDefaultBillingProfile(trx, tenant, input.clientId);

      const [created] = await tenantDb(trx, tenant)
        .table('client_billing_profiles')
        .insert(
          {
            tenant,
            client_id: input.clientId,
            name,
            is_default: false,
            is_system_managed_default: false,
            is_active: true,
            created_by: user.user_id,
            updated_by: user.user_id,
          },
          ['billing_profile_id', 'client_id', 'name', 'is_default', 'is_active', 'is_system_managed_default'],
        );
      return created as ClientBillingProfile;
    });
  } catch (error) {
    const expected = billingProfileActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const renameClientBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string; name: string },
): Promise<{ success: true } | ClientBillingProfileActionError> => {
  const name = input.name?.trim();
  if (!name) {
    return actionError('A billing profile needs a name.');
  }

  try {
    await assertCanUpdate(user);
    const { knex } = await createTenantKnex();
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await tenantDb(trx, tenant)
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .update({
          name,
          // A renamed profile is no longer the one the system named.
          is_system_managed_default: false,
          updated_by: user.user_id,
          updated_at: knex.fn.now(),
        });
    });
    return { success: true };
  } catch (error) {
    const expected = billingProfileActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Move the client's default to another profile (F039).
 *
 * Both writes happen in one transaction: the F002 guard is deferred to COMMIT
 * precisely so an atomic switch is expressible, while a committed
 * zero-default state stays unreachable.
 */
export const setDefaultClientBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { clientId: string; billingProfileId: string },
): Promise<{ success: true } | ClientBillingProfileActionError> => {
  try {
    await assertCanUpdate(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const target = await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId, client_id: input.clientId })
        .first('is_active');
      if (!target) {
        return actionError('That billing profile does not belong to this client.');
      }
      if (!target.is_active) {
        return actionError('An archived billing profile cannot be made the default.');
      }

      await db
        .table('client_billing_profiles')
        .where({ client_id: input.clientId })
        .whereNot({ billing_profile_id: input.billingProfileId })
        .update({ is_default: false, updated_by: user.user_id, updated_at: knex.fn.now() });
      await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .update({ is_default: true, updated_by: user.user_id, updated_at: knex.fn.now() });

      return { success: true as const };
    });
  } catch (error) {
    const expected = billingProfileActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Archiving removes a profile from pickers without touching history (F038).
 * The default may not be archived (F040): it is where attribution terminates,
 * so archiving it would leave charges pointing at a profile no one can see.
 */
export const archiveClientBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string },
): Promise<{ success: true } | ClientBillingProfileActionError> => {
  try {
    await assertCanUpdate(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const profile = await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .first('is_default');
      if (!profile) {
        return actionError('That billing profile no longer exists.');
      }
      if (profile.is_default) {
        return actionError(
          'The default billing profile cannot be archived. Make another profile the default first.',
        );
      }

      await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .update({ is_active: false, updated_by: user.user_id, updated_at: knex.fn.now() });
      return { success: true as const };
    });
  } catch (error) {
    const expected = billingProfileActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const unarchiveClientBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string },
): Promise<{ success: true } | ClientBillingProfileActionError> => {
  try {
    await assertCanUpdate(user);
    const { knex } = await createTenantKnex();
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await tenantDb(trx, tenant)
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .update({ is_active: true, updated_by: user.user_id, updated_at: knex.fn.now() });
    });
    return { success: true };
  } catch (error) {
    const expected = billingProfileActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Deletion is only for profiles nothing points at (F041). Once a charge has
 * been attributed to a profile, deleting it would erase the attribution rather
 * than retire the profile — so the user is offered archiving instead.
 */
export const deleteClientBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { billingProfileId: string },
): Promise<{ success: true } | ClientBillingProfileActionError> => {
  try {
    await assertCanUpdate(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const profile = await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .first('is_default');
      if (!profile) {
        return actionError('That billing profile no longer exists.');
      }
      if (profile.is_default) {
        return actionError(
          'The default billing profile cannot be deleted. Make another profile the default first.',
        );
      }

      const references = await referencesToProfile(trx, tenant, input.billingProfileId);
      if (references.length > 0) {
        return actionError(
          `This billing profile is used by ${references.join(', ')}. Archive it instead — deleting it would erase how those charges were attributed.`,
        );
      }

      await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .del();
      return { success: true as const };
    });
  } catch (error) {
    const expected = billingProfileActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

type ProfileAssignmentTarget =
  | { kind: 'contract'; clientContractId: string }
  | { kind: 'contract_line'; contractLineId: string }
  | { kind: 'location'; locationId: string }
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'project'; projectId: string };

interface AssignmentSpec {
  table: string;
  keyColumn: string;
  keyField: string;
  profileColumn: string;
  /**
   * How to reach the owning client. Contract lines hang off a contract rather
   * than a client, so they resolve through `client_contracts`.
   */
  clientColumn: string | null;
  tracksActor: boolean;
}

const ASSIGNMENT_TABLES: Record<ProfileAssignmentTarget['kind'], AssignmentSpec> = {
  contract: {
    table: 'client_contracts',
    keyColumn: 'client_contract_id',
    keyField: 'clientContractId',
    profileColumn: 'billing_profile_id',
    clientColumn: 'client_id',
    tracksActor: false,
  },
  contract_line: {
    table: 'contract_lines',
    keyColumn: 'contract_line_id',
    keyField: 'contractLineId',
    profileColumn: 'billing_profile_id',
    clientColumn: null,
    tracksActor: false,
  },
  location: {
    table: 'client_locations',
    keyColumn: 'location_id',
    keyField: 'locationId',
    profileColumn: 'default_billing_profile_id',
    clientColumn: 'client_id',
    tracksActor: false,
  },
  ticket: {
    table: 'tickets',
    keyColumn: 'ticket_id',
    keyField: 'ticketId',
    profileColumn: 'billing_profile_id',
    clientColumn: 'client_id',
    tracksActor: true,
  },
  project: {
    table: 'projects',
    keyColumn: 'project_id',
    keyField: 'projectId',
    profileColumn: 'billing_profile_id',
    clientColumn: 'client_id',
    tracksActor: false,
  },
};

/** The client that owns the record a profile is being assigned to. */
async function ownerClientIdFor(
  trx: Knex.Transaction,
  tenant: string,
  target: ProfileAssignmentTarget,
  keyValue: string,
): Promise<string | null> {
  const db = tenantDb(trx, tenant);
  if (target.kind === 'contract_line') {
    const query = db.table('contract_lines');
    db.tenantJoin(query, 'client_contracts', 'client_contracts.contract_id', 'contract_lines.contract_id');
    const row = await query
      .where({ 'contract_lines.contract_line_id': keyValue })
      .first('client_contracts.client_id');
    return (row?.client_id as string | undefined) ?? null;
  }
  const spec = ASSIGNMENT_TABLES[target.kind];
  const row = await db
    .table(spec.table)
    .where({ [spec.keyColumn]: keyValue })
    .first(spec.clientColumn as string);
  return (row?.[spec.clientColumn as string] as string | undefined) ?? null;
}

/**
 * Point a record at a billing profile, or clear the assignment with null.
 *
 * A profile from another client is rejected (F051): assignment is what decides
 * which invoice a charge lands on, so a cross-client assignment is a billing
 * error, not a UI slip.
 */
export const assignBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { target: ProfileAssignmentTarget; billingProfileId: string | null },
): Promise<{ success: true } | ClientBillingProfileActionError> => {
  try {
    await assertCanUpdate(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const spec = ASSIGNMENT_TABLES[input.target.kind];
      const keyValue = (input.target as unknown as Record<string, string>)[spec.keyField];

      if (input.billingProfileId) {
        const ownerClientId = await ownerClientIdFor(trx, tenant, input.target, keyValue);
        const profile = await db
          .table('client_billing_profiles')
          .where({ billing_profile_id: input.billingProfileId })
          .first('client_id', 'is_active');
        if (!ownerClientId || !profile) {
          return actionError('That record or billing profile no longer exists.');
        }
        if (ownerClientId !== profile.client_id) {
          return actionError('That billing profile belongs to a different client.');
        }
        if (!profile.is_active) {
          return actionError('That billing profile is archived.');
        }
      }

      await db
        .table(spec.table)
        .where({ [spec.keyColumn]: keyValue })
        .update({
          [spec.profileColumn]: input.billingProfileId,
          // Records who changed the assignment and when, on the tables that
          // carry an actor column (F052).
          ...(spec.tracksActor ? { updated_by: user.user_id } : {}),
          updated_at: knex.fn.now(),
        });
      return { success: true as const };
    });
  } catch (error) {
    const expected = billingProfileActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
