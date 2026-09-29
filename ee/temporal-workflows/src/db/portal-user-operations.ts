import { Context } from '@temporalio/activity';
import { tenantDb } from '@alga-psa/db';
import {
  getAdminConnection,
  retryOnAdminReadOnly,
  withAdminTransactionRetryReadOnly,
} from '@alga-psa/db/admin.js';
import type { Knex } from 'knex';
import { generateSecurePassword } from '@alga-psa/core/encryption';
import { 
  createPortalUserInDB as createPortalUserInSharedModel,
  CreatePortalUserInput
} from '@alga-psa/shared/models/userModel.js';
import type {
  CreatePortalUserActivityInput,
  CreatePortalUserActivityResult
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

/**
 * Raised when a client-portal account already exists for the admin email but is
 * attached to a different contact/client than the one this onboarding resolved.
 * Returning `existing` then would report working portal access for the wrong
 * account, so we refuse and change nothing.
 */
export class PortalUserIdentityMismatchError extends Error {
  readonly email: string;
  readonly existingUserId: string;
  readonly existingContactId: string | null;
  readonly expectedContactId: string;
  readonly expectedClientId: string;

  constructor(details: {
    email: string;
    existingUserId: string;
    existingContactId: string | null;
    expectedContactId: string;
    expectedClientId: string;
  }) {
    super(
      `A client-portal account for "${details.email}" already exists (${details.existingUserId}) ` +
      `but is linked to contact ${details.existingContactId ?? 'none'}, not the resolved contact ` +
      `${details.expectedContactId} under client ${details.expectedClientId}; refusing to reuse an ` +
      `unrelated portal account.`
    );
    this.name = 'PortalUserIdentityMismatchError';
    this.email = details.email;
    this.existingUserId = details.existingUserId;
    this.existingContactId = details.existingContactId;
    this.expectedContactId = details.expectedContactId;
    this.expectedClientId = details.expectedClientId;
  }
}

/**
 * Look up an existing client-portal user (and its role grant) for an email in a
 * tenant. Returns null when none exists. Throws when an account exists but its
 * contact/client linkage does not match the one this onboarding resolved.
 */
async function findExistingClientPortalUser(
  tenantId: string,
  normalizedEmail: string,
  expected: { contactId: string; clientId: string }
): Promise<{ userId: string; roleId: string } | null> {
  const existingUser = await retryOnAdminReadOnly(
    async () => {
      const knex = await getAdminConnection();
      return await tenantDb(knex, tenantId).table('users')
        .where({
          email: normalizedEmail,
          user_type: 'client'
        })
        .first();
    },
    { logLabel: 'findExistingPortalUser' }
  );

  if (!existingUser) {
    return null;
  }

  // A user row alone says nothing about *which* contact/client it grants access
  // to. Resolve the linked contact and require it to match what we just
  // resolved before calling this account reusable.
  const linkedContact = existingUser.contact_id
    ? await retryOnAdminReadOnly(
        async () => {
          const knex = await getAdminConnection();
          return await tenantDb(knex, tenantId).table('contacts')
            .where({ contact_name_id: existingUser.contact_id })
            .select('client_id')
            .first();
        },
        { logLabel: 'findExistingPortalUserContact' }
      )
    : null;

  const linkedClientId = linkedContact?.client_id ?? null;
  if (existingUser.contact_id !== expected.contactId || linkedClientId !== expected.clientId) {
    throw new PortalUserIdentityMismatchError({
      email: normalizedEmail,
      existingUserId: existingUser.user_id,
      existingContactId: existingUser.contact_id ?? null,
      expectedContactId: expected.contactId,
      expectedClientId: expected.clientId,
    });
  }

  const existingRole = await retryOnAdminReadOnly(
    async () => {
      const knex = await getAdminConnection();
      return await tenantDb(knex, tenantId).table('user_roles')
        .where({ user_id: existingUser.user_id })
        .first();
    },
    { logLabel: 'findExistingPortalUserRole' }
  );

  return { userId: existingUser.user_id, roleId: existingRole?.role_id ?? '' };
}

/**
 * Create a portal user in the database
 * This wraps the shared model function and adds temporal-specific logic
 */
export async function createPortalUserInDB(
  input: CreatePortalUserActivityInput
): Promise<CreatePortalUserActivityResult> {
  const log = logger();
  log.info('Creating portal user in database', {
    email: input.email,
    tenantId: input.tenantId,
    contactId: input.contactId,
    clientId: input.clientId
  });

  try {
    // Match the client/contact paths: trim + lowercase so an admin email with
    // stray whitespace resolves to the same contact and portal account.
    const normalizedEmail = input.email.trim().toLowerCase();

    // Reuse an existing client-portal user instead of letting the shared model
    // throw. The shared model's duplicate guard is intentionally left intact for
    // the rest of the app; reuse is handled here, at the EE boundary. We return
    // the existing account untouched: no password re-hash, no role assignment,
    // no reactivation.
    const existing = await findExistingClientPortalUser(input.tenantId, normalizedEmail, {
      contactId: input.contactId,
      clientId: input.clientId,
    });
    if (existing) {
      log.info('Reusing existing portal user (not modifying password or roles)', {
        userId: existing.userId,
        tenantId: input.tenantId,
        roleId: existing.roleId
      });

      return {
        userId: existing.userId,
        roleId: existing.roleId,
        status: 'existing'
      };
    }

    // If no password provided, generate a secure temporary password
    const password = input.password || generateSecurePassword();

    // Map to shared model input (ensure email is lowercased)
    const sharedModelInput: CreatePortalUserInput = {
      email: normalizedEmail,
      password,
      contactId: input.contactId,
      clientId: input.clientId,
      tenantId: input.tenantId,
      firstName: input.firstName,
      lastName: input.lastName,
      roleId: input.roleId,
      isClientAdmin: input.isClientAdmin
    };

    // Use the shared model to create the portal user.
    // Wrap in retryOnAdminReadOnly so a stale Citus loopback "worker" connection
    // (PgBouncer/Patroni post-failover) refreshes the admin pool and retries once.
    const result = await retryOnAdminReadOnly(
      async () => {
        const knex = await getAdminConnection();
        return await createPortalUserInSharedModel(knex, sharedModelInput);
      },
      { logLabel: 'createPortalUserInDB' }
    );

    if (!result.success) {
      // A concurrent run may have won the insert between our lookup and this
      // call. Re-read once so the race converges on the existing account rather
      // than reporting a false failure.
      const raced = await findExistingClientPortalUser(input.tenantId, normalizedEmail, {
        contactId: input.contactId,
        clientId: input.clientId,
      });
      if (raced) {
        log.info('Reusing portal user created by a concurrent run', {
          userId: raced.userId,
          tenantId: input.tenantId
        });
        return { userId: raced.userId, roleId: raced.roleId, status: 'existing' };
      }

      throw new Error(result.error || 'Failed to create portal user');
    }

    log.info('Portal user created successfully', {
      userId: result.userId,
      tenantId: input.tenantId,
      roleId: result.roleId
    });

    return {
      userId: result.userId!,
      roleId: result.roleId!,
      temporaryPassword: input.password ? undefined : password,
      status: 'created'
    };

  } catch (error) {
    if (error instanceof PortalUserIdentityMismatchError) {
      // A deliberate refusal, not a provisioning failure. Preserve the type so
      // Temporal classifies it as non-retryable and Step 5d can record the real
      // reason instead of a generic "Failed to create portal user".
      log.error('Refusing to reuse a portal account with mismatched identity', {
        error: error.message,
        email: error.email,
        existingUserId: error.existingUserId,
      });
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to create portal user', { error: errorMessage });
    throw new Error(`Failed to create portal user: ${errorMessage}`);
  }
}

/**
 * Rollback portal user creation (for error handling)
 */
export async function rollbackPortalUserInDB(userId: string, tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back portal user creation', { userId, tenantId });

  try {
    await withAdminTransactionRetryReadOnly(async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenantId);
      // Delete user associations in reverse order
      await db.table('user_roles')
        .where({ user_id: userId })
        .delete();

      await db.table('users')
        .where({ user_id: userId })
        .delete();
    });

    log.info('Portal user rollback completed', { userId, tenantId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to rollback portal user', { error: errorMessage, userId, tenantId });
    // Don't throw here - rollback failures shouldn't mask the original error
  }
}
