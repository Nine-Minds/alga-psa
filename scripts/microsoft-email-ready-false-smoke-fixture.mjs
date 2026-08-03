#!/usr/bin/env node

/**
 * Create a reversible, tenant-scoped Microsoft Email readiness smoke fixture.
 *
 * The fixture models a fully credentialed tenant-owned Email profile whose
 * administrator consent is still pending. It binds that profile directly so
 * the mailbox form's defensive ready:false UI can be exercised. Normal product
 * onboarding deliberately waits for consent before creating this binding.
 *
 * Usage:
 *   node scripts/microsoft-email-ready-false-smoke-fixture.mjs apply <tenant-id>
 *   node scripts/microsoft-email-ready-false-smoke-fixture.mjs status <tenant-id>
 *   node scripts/microsoft-email-ready-false-smoke-fixture.mjs cleanup <tenant-id>
 *
 * Database settings use the same DB_* environment variables as the migration
 * tooling. The state file contains only profile IDs and is written to /tmp by
 * default; set MICROSOFT_EMAIL_READY_FALSE_STATE_FILE to override it.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import knexFactory from 'knex';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const [command, tenantId] = process.argv.slice(2);
const allowedCommands = new Set(['apply', 'status', 'cleanup']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!allowedCommands.has(command) || !uuidPattern.test(tenantId || '')) {
  console.error(
    'Usage: node scripts/microsoft-email-ready-false-smoke-fixture.mjs <apply|status|cleanup> <tenant-id>'
  );
  process.exit(1);
}

function deterministicUuid(value) {
  const bytes = crypto.createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const fixtureProfileId = deterministicUuid(`alga0002215:${tenantId}:ready-false-profile`);
const fixtureDisplayName = 'Smoke Microsoft Email - Consent Pending (alga0002215)';
const fixtureSecretRef = `microsoft_profile_${fixtureProfileId}_client_secret`;
const stateFile = process.env.MICROSOFT_EMAIL_READY_FALSE_STATE_FILE
  || path.join(os.tmpdir(), `alga0002215-microsoft-email-ready-false-${tenantId}.json`);

const db = knexFactory({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT_DIRECT || process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: process.env.DB_PASSWORD_ADMIN || 'postpass123',
    database: process.env.DB_NAME_SERVER || 'server',
  },
});

const secretProvider = await getSecretProviderInstance();

function scoped(table) {
  return db(table).where({ tenant: tenantId });
}

async function readStatus() {
  const [profile, binding, clientSecret] = await Promise.all([
    scoped('microsoft_profiles').where({ profile_id: fixtureProfileId }).first(),
    scoped('microsoft_profile_consumer_bindings').where({ consumer_type: 'email' }).first(),
    secretProvider.getTenantSecret(tenantId, fixtureSecretRef),
  ]);

  return {
    tenantId,
    fixtureProfileId,
    profileExists: Boolean(profile),
    emailBindingProfileId: binding?.profile_id || null,
    boundToFixture: binding?.profile_id === fixtureProfileId,
    clientIdConfigured: Boolean(profile?.client_id),
    clientSecretConfigured: Boolean(clientSecret),
    tenantIdConfigured: Boolean(profile?.tenant_id),
    emailAdminConsentRequired: Boolean(profile?.email_admin_consent_required),
    emailAdminConsentGranted: Boolean(profile?.email_admin_consent_granted_at),
    expectedReady: false,
    stateFile,
  };
}

async function applyFixture() {
  const tenant = await db('tenants').where({ tenant: tenantId }).first('tenant');
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} does not exist`);
  }
  if (fs.existsSync(stateFile)) {
    const status = await readStatus();
    if (status.boundToFixture && status.profileExists) {
      return status;
    }
    throw new Error(`Fixture state file already exists but the database state is inconsistent: ${stateFile}`);
  }

  const [existingFixture, existingBinding] = await Promise.all([
    scoped('microsoft_profiles').where({ profile_id: fixtureProfileId }).first(),
    scoped('microsoft_profile_consumer_bindings').where({ consumer_type: 'email' }).first(),
  ]);
  if (existingFixture) {
    throw new Error(`Fixture profile ${fixtureProfileId} already exists without a state file; remove it manually after review`);
  }

  fs.writeFileSync(
    stateFile,
    `${JSON.stringify({ tenantId, fixtureProfileId, previousEmailProfileId: existingBinding?.profile_id || null }, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 }
  );

  try {
    await secretProvider.setTenantSecret(tenantId, fixtureSecretRef, 'smoke-secret-alga0002215-not-for-oauth');
    const now = new Date();
    await db.transaction(async (trx) => {
      await trx('microsoft_profiles').insert({
        tenant: tenantId,
        profile_id: fixtureProfileId,
        display_name: fixtureDisplayName,
        display_name_normalized: fixtureDisplayName.toLocaleLowerCase(),
        client_id: 'smoke-consent-pending-client-alga0002215',
        tenant_id: 'smoke-consent-pending-tenant-alga0002215',
        client_secret_ref: fixtureSecretRef,
        email_admin_consent_required: true,
        email_admin_consent_granted_at: null,
        email_admin_consent_tenant_id: null,
        capabilities: JSON.stringify(['email']),
        is_default: false,
        is_archived: false,
        archived_at: null,
        created_by: null,
        updated_by: null,
        created_at: now,
        updated_at: now,
      });

      const binding = await trx('microsoft_profile_consumer_bindings')
        .where({ tenant: tenantId, consumer_type: 'email' })
        .first();
      if (binding) {
        await trx('microsoft_profile_consumer_bindings')
          .where({ tenant: tenantId, consumer_type: 'email' })
          .update({ profile_id: fixtureProfileId, updated_by: null, updated_at: now });
      } else {
        await trx('microsoft_profile_consumer_bindings').insert({
          tenant: tenantId,
          consumer_type: 'email',
          profile_id: fixtureProfileId,
          created_by: null,
          updated_by: null,
          created_at: now,
          updated_at: now,
        });
      }
    });
  } catch (error) {
    await secretProvider.setTenantSecret(tenantId, fixtureSecretRef, null).catch(() => undefined);
    fs.rmSync(stateFile, { force: true });
    throw error;
  }

  return readStatus();
}

async function cleanupFixture() {
  if (!fs.existsSync(stateFile)) {
    throw new Error(`Fixture state file does not exist: ${stateFile}`);
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state.tenantId !== tenantId || state.fixtureProfileId !== fixtureProfileId) {
    throw new Error(`Fixture state file does not match tenant/profile: ${stateFile}`);
  }

  await db.transaction(async (trx) => {
    const binding = await trx('microsoft_profile_consumer_bindings')
      .where({ tenant: tenantId, consumer_type: 'email' })
      .first();
    if (binding?.profile_id !== fixtureProfileId) {
      throw new Error('Email binding no longer points to the smoke fixture; refusing to overwrite newer product state');
    }

    if (state.previousEmailProfileId) {
      const previousProfile = await trx('microsoft_profiles')
        .where({ tenant: tenantId, profile_id: state.previousEmailProfileId, is_archived: false })
        .first();
      if (!previousProfile) {
        throw new Error(`Previous Email profile ${state.previousEmailProfileId} is unavailable; refusing cleanup`);
      }
      await trx('microsoft_profile_consumer_bindings')
        .where({ tenant: tenantId, consumer_type: 'email' })
        .update({ profile_id: state.previousEmailProfileId, updated_by: null, updated_at: new Date() });
    } else {
      await trx('microsoft_profile_consumer_bindings')
        .where({ tenant: tenantId, consumer_type: 'email' })
        .delete();
    }

    await trx('microsoft_profiles')
      .where({ tenant: tenantId, profile_id: fixtureProfileId })
      .delete();
  });

  await secretProvider.setTenantSecret(tenantId, fixtureSecretRef, null);
  fs.rmSync(stateFile);
  return {
    tenantId,
    fixtureProfileId,
    restoredEmailProfileId: state.previousEmailProfileId || null,
    cleanedUp: true,
  };
}

try {
  const result = command === 'apply'
    ? await applyFixture()
    : command === 'cleanup'
      ? await cleanupFixture()
      : await readStatus();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.destroy();
}
