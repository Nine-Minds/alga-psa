#!/usr/bin/env node

/**
 * Reset the original appliance administrator's application password.
 *
 * This script runs only inside the short-lived recovery Job created by the
 * appliance control plane. Its inputs are Secret-backed environment variables;
 * no credential is accepted on the command line or written to output.
 */

import { pathToFileURL } from 'node:url';

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

/**
 * Database operation kept injectable so integration tests can exercise the
 * exact production guard and mutation against a migrated schema.
 */
export async function resetInitialAdminPassword({
  db,
  tenantId,
  email,
  password,
  hashPassword,
}) {
  if (!db || typeof db.transaction !== 'function') {
    throw new Error('An admin database connection is required.');
  }
  if (typeof hashPassword !== 'function') {
    throw new Error('The application password hasher is required.');
  }

  const targetTenantId = required(tenantId, 'Initial tenant id');
  const targetEmail = required(email, 'Initial admin email').toLowerCase();
  const replacementPassword = required(password, 'Replacement password');
  const replacementHash = await hashPassword(replacementPassword);

  return db.transaction(async (trx) => {
    const matches = await trx('users')
      .select('user_id')
      .where({
        tenant: targetTenantId,
        email: targetEmail,
        user_type: 'internal',
      })
      .forUpdate();

    if (matches.length !== 1) {
      throw new Error('Expected exactly one original appliance administrator.');
    }

    const updated = await trx('users')
      .where({
        user_id: matches[0].user_id,
        tenant: targetTenantId,
        email: targetEmail,
        user_type: 'internal',
      })
      .update({ hashed_password: replacementHash });

    if (updated !== 1) {
      throw new Error('The original appliance administrator was not updated.');
    }

    return { userId: matches[0].user_id };
  });
}

async function main() {
  const [{ hashPassword }, { getAdminConnection, destroyAdminConnection }] = await Promise.all([
    import('@alga-psa/core/encryption'),
    import('@alga-psa/db/admin'),
  ]);

  try {
    const db = await getAdminConnection();
    await resetInitialAdminPassword({
      db,
      tenantId: process.env.RESET_ADMIN_TENANT_ID,
      email: process.env.RESET_ADMIN_EMAIL,
      password: process.env.RESET_ADMIN_PASSWORD,
      hashPassword,
    });
    console.log('Initial Alga administrator password reset completed.');
  } finally {
    await destroyAdminConnection().catch(() => {});
  }
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  main().catch(() => {
    console.error('Initial Alga administrator password reset failed.');
    process.exitCode = 1;
  });
}
