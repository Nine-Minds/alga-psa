#!/usr/bin/env node

/**
 * Guarded, idempotent recovery for a missing Nine Minds Support Portal user.
 *
 * Incident target (see docs/runbooks/nineminds-portal-user-recovery.md):
 *   management tenant 55f6a1b8-8ad9-42c7-ba39-a508dcaecd37
 *   client            8785fc7c-5004-4413-902a-aa96c364c051
 *   contact           d78d1809-ad15-479c-97da-a167329ff6d5
 *
 * This script is deliberately NOT wired into the tenant-creation workflow and
 * does NOT run automatically. It reuses the same shared portal-user model the
 * application uses (so hashing and role selection match production), and it is
 * safe to re-run:
 *   - if a client-portal user already exists for the contact's email, it prints
 *     the existing account and exits without changing anything.
 *   - it never updates an existing user's password, roles, or activation state.
 *   - it only ever touches the single management tenant configured below.
 *
 * Usage (from ee/temporal-workflows, with the production DB environment loaded):
 *   CONFIRM_NINEMINDS_PORTAL_RECOVERY=yes npx tsx src/scripts/recover-nineminds-portal-user.ts
 */

import * as dotenv from 'dotenv';
import { tenantDb } from '@alga-psa/db';
import { destroyAdminConnection, getAdminConnection } from '@alga-psa/db/admin.js';
import { generateSecurePassword } from '@alga-psa/core/encryption';
import {
  createPortalUserInDB as createPortalUserInSharedModel,
} from '@alga-psa/shared/models/userModel.js';

dotenv.config();

const MANAGEMENT_TENANT_ID = '55f6a1b8-8ad9-42c7-ba39-a508dcaecd37';
const TARGET_CLIENT_ID = '8785fc7c-5004-4413-902a-aa96c364c051';
const TARGET_CONTACT_ID = 'd78d1809-ad15-479c-97da-a167329ff6d5';

function requireConfirmation(): void {
  if (process.env.CONFIRM_NINEMINDS_PORTAL_RECOVERY !== 'yes') {
    console.error(
      'Refusing to run without CONFIRM_NINEMINDS_PORTAL_RECOVERY=yes. ' +
        'This script writes to the Nine Minds management tenant.'
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  requireConfirmation();

  const knex = await getAdminConnection();
  const db = tenantDb(knex, MANAGEMENT_TENANT_ID);

  const contact = await db
    .table('contacts')
    .where({ contact_name_id: TARGET_CONTACT_ID, client_id: TARGET_CLIENT_ID })
    .first();

  if (!contact) {
    throw new Error(
      `Contact ${TARGET_CONTACT_ID} not found under client ${TARGET_CLIENT_ID} ` +
        `in management tenant ${MANAGEMENT_TENANT_ID}.`
    );
  }

  const email = String(contact.email ?? '').trim().toLowerCase();
  if (!email) {
    throw new Error(`Contact ${TARGET_CONTACT_ID} has no email address; cannot provision a portal user.`);
  }

  // Idempotency guard: never touch an existing portal account.
  const existingUser = await db
    .table('users')
    .where({ email, user_type: 'client' })
    .first();

  if (existingUser) {
    console.log(
      `Portal user already exists for ${email}: user_id=${existingUser.user_id}. ` +
        'No changes made.'
    );
    return;
  }

  const [firstName = '', ...rest] = String(contact.full_name ?? '').trim().split(/\s+/);
  const lastName = rest.join(' ');
  const password = generateSecurePassword();

  const result = await createPortalUserInSharedModel(knex, {
    tenantId: MANAGEMENT_TENANT_ID,
    email,
    password,
    contactId: TARGET_CONTACT_ID,
    clientId: TARGET_CLIENT_ID,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    isClientAdmin: true,
  });

  if (!result.success) {
    throw new Error(`Portal user creation failed: ${result.error ?? 'unknown error'}`);
  }

  console.log(`Created portal user ${result.userId} for ${email}.`);
  console.log(`One-time temporary password: ${password}`);
  console.log(
    'Deliver this password only through the incident channel, and have the user ' +
      'change it at first sign-in. Do not paste it into tickets or chat.'
  );
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await destroyAdminConnection();
  });
