#!/usr/bin/env -S npx tsx
/**
 * Co-managed IT review fixtures.
 *
 * Builds a durable, idempotent data set so a reviewer can exercise every
 * co-managed capability area at http://100.82.172.57:3374 without preparing
 * anything first. See docs/dev/co-managed-fixtures.md.
 *
 *   npm run fixtures:co-managed            apply (idempotent)
 *   npm run fixtures:co-managed -- --reset remove fixture data, restore baseline
 *   npm run fixtures:co-managed -- --verify print the row ids per capability area
 *
 * Every identifier is derived with uuidv5 from a fixed namespace plus a stable
 * slug, and every timestamp is a fixed instant, so a second apply rewrites the
 * same bytes. Reruns upsert; nothing is consumed and deleted.
 *
 * Credentials come from server/.env.local, parsed line by line. Do NOT use
 * `set -a; . ./.env.local`: DB_PASSWORD_SERVER and REDIS_PASSWORD contain an
 * unquoted '&', which bash reads as the background operator, silently leaving
 * both empty.
 */
import { createHash, pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory, { type Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Parse a dotenv file without a shell, so values containing '&' survive. */
// LEVERAGE: pattern co-managed-env-local — third hand-rolled line-by-line reader
// of server/.env.local (scripts/dev/load-env-local.sh and
// scripts/dev/generate-co-managed-worker-env.sh are the others). The shell ones
// cannot be reused from Node; a shared loader belongs below this layer.
function loadEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const ENV = loadEnvFile(path.join(REPO_ROOT, 'server/.env.local'));
for (const [key, value] of Object.entries(ENV)) process.env[key] ??= value;

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is missing or empty in server/.env.local (check the '&' quoting trap)`);
  return value;
}

// The isolated co-managed database is reachable only on the direct PostgreSQL
// port. pgbouncer routes the "server"/"postgres" databases and nothing else.
const CONNECTION = {
  host: required('DB_HOST'),
  port: Number(required('DB_PORT')),
  database: required('DB_NAME_SERVER'),
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: required('DB_PASSWORD_ADMIN'),
};

// ---------------------------------------------------------------------------
// Deterministic identity
// ---------------------------------------------------------------------------

const FIXTURE_NAMESPACE = '2f6a1d54-9c3b-4d08-8a71-5e0c9b47d213';

/** Stable uuid for a fixture slug. Reruns address the same rows. */
const id = (slug: string): string => uuidv5(`co-managed-fixtures/${slug}`, FIXTURE_NAMESPACE);
/** Stable lowercase sha-256, for the hex-64 fingerprint columns. */
const fingerprint = (slug: string): string => createHash('sha256').update(`co-managed-fixtures/${slug}`).digest('hex');
const hashPayload = (payload: unknown): string => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

/** Fixed clock. Fixture timestamps never drift, so two applies compare equal. */
const EPOCH = Date.parse('2026-09-15T09:00:00.000Z');
const at = (offsetHours: number): Date => new Date(EPOCH + offsetHours * 3_600_000);
const ISO = (offsetHours: number): string => at(offsetHours).toISOString();

const CREATED = at(-24 * 30);
const VALID_UNTIL = new Date(Date.parse('2027-12-31T00:00:00.000Z'));

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/**
 * PBKDF2 salt:hash in the application's stored format, with a salt derived from
 * the fixture slug so the row is byte-stable across runs. The shared helper
 * hashPassword() picks a random salt, which would make every apply differ; its
 * companion verifyPassword() is used below as the oracle that every hash this
 * produces is genuinely accepted by the application.
 */
function deterministicPassword(slug: string, password: string, secret: string): string {
  const salt = createHash('sha256').update(`co-managed-fixtures/password-salt/${slug}`).digest('hex').slice(0, 24);
  const hash = pbkdf2Sync(password, secret + salt, 10_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// ---------------------------------------------------------------------------
// Fixed tenants that already exist in this environment
// ---------------------------------------------------------------------------

const OZ = '569e72fc-52d9-4ce2-838e-a34ea8cf2f9f';                 // sponsoring MSP
const RABBIT = '51ac6952-6d6f-4600-aace-b71a9b2a5e73';             // live customer, headroom
const EMERALD = '5ff4fb80-b8d0-42c5-939d-7b76afb6de87';            // terminated + sealed customer
const RABBIT_RELATIONSHIP = '73950eda-1f0e-4196-8480-2ca096c9685d';
const EMERALD_RELATIONSHIP = '3559d6b5-5e51-4766-b891-014d85f31429';
const OZ_RABBIT_CLIENT = '4320b23c-e022-44d4-b811-32b1c85873a2';
const OZ_ESCALATION_BOARD = '0bd2216f-aa9b-4265-9134-698b5bb7141e';
const RABBIT_SERVICE_DESK = '59c51e85-5942-4580-81fa-8a924d60ff89';
const RABBIT_SELF_CLIENT = '47e7f869-e276-457d-a75e-9096cd3a6f0a';
const RABBIT_ALLOCATION = 'c00d4346-003e-4f67-8a6c-654f06ceb92d';

/** State observed before this fixture was first applied; --reset restores it. */
const BASELINE = {
  entitlementCapacity: 3,
  entitlementSourceReference: 'smoke-fixture-sub-2026-09-09',
  entitlementValidUntil: new Date(Date.parse('2026-10-09T02:57:57.324Z')),
  rabbitAllocationSeats: 1,
};

// ---------------------------------------------------------------------------
// The second customer workspace, created and owned by this fixture
// ---------------------------------------------------------------------------

const MUNCHKIN = id('tenant/munchkin');
const MUNCHKIN_RELATIONSHIP = id('relationship/munchkin');
const MUNCHKIN_BOARD = id('board/munchkin/service-desk');
const MUNCHKIN_SELF_CLIENT = id('client/munchkin/self');
const OZ_MUNCHKIN_CLIENT = id('client/oz/munchkin');
const MUNCHKIN_ALLOCATION = id('allocation/munchkin');
const MUNCHKIN_PROVISIONING = id('provisioning/munchkin');

interface FixtureUser {
  slug: string;
  tenant: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roleName: string;
  password: string;
  organization: string;
}

const USERS: FixtureUser[] = [
  { slug: 'user/oz/admin', tenant: OZ, userId: id('user/oz/admin'), email: 'cm.msp.admin@oz.test',
    firstName: 'Cassia', lastName: 'Marsh', roleName: 'Admin', password: 'FixtureMspAdmin!2026', organization: 'Oz' },
  { slug: 'user/oz/tech', tenant: OZ, userId: id('user/oz/tech'), email: 'cm.msp.tech@oz.test',
    firstName: 'Piet', lastName: 'Okonkwo', roleName: 'Technician', password: 'FixtureMspTech!2026', organization: 'Oz' },
  { slug: 'user/rabbit/admin', tenant: RABBIT, userId: id('user/rabbit/admin'), email: 'cm.rabbit.admin@whiterabbit.test',
    firstName: 'Bea', lastName: 'Halloran', roleName: 'Admin', password: 'FixtureRabbitAdmin!2026', organization: 'White Rabbit' },
  { slug: 'user/rabbit/tech', tenant: RABBIT, userId: id('user/rabbit/tech'), email: 'cm.rabbit.tech@whiterabbit.test',
    firstName: 'Tomas', lastName: 'Reyes', roleName: 'Technician', password: 'FixtureRabbitTech!2026', organization: 'White Rabbit' },
  { slug: 'user/munchkin/admin', tenant: MUNCHKIN, userId: id('user/munchkin/admin'), email: 'cm.munchkin.admin@munchkin.test',
    firstName: 'Nara', lastName: 'Osei', roleName: 'Admin', password: 'FixtureMunchkinAdmin!2026', organization: 'Munchkin Country IT' },
  { slug: 'user/munchkin/tech', tenant: MUNCHKIN, userId: id('user/munchkin/tech'), email: 'cm.munchkin.tech@munchkin.test',
    firstName: 'Ivar', lastName: 'Lindqvist', roleName: 'Technician', password: 'FixtureMunchkinTech!2026', organization: 'Munchkin Country IT' },
];

const byslug = (slug: string): FixtureUser => {
  const found = USERS.find(user => user.slug === slug);
  if (!found) throw new Error(`Unknown fixture user ${slug}`);
  return found;
};

// Capability-area rows.
const SLA_POLICY = id('sla-policy/oz/co-managed-escalation');
const READY_TICKET = id('ticket/rabbit/ready-to-escalate');
const ESCALATED_TICKET = id('ticket/rabbit/already-escalated');
const ESCALATED_WORK = id('work/rabbit/already-escalated');
const ESCALATION_OPERATION = id('operation/rabbit/escalation');
const SLA_OBLIGATION = id('sla-obligation/rabbit/already-escalated');
const SLA_START_OPERATION = id('operation/rabbit/sla-start');
const PRIVATE_BOARD = id('board/rabbit/executive-private');
const TIME_REFERENCE = id('time-reference/rabbit/already-escalated');
const SHARED_PROJECT = id('project/rabbit/network-refresh');
const SHARED_TASK = id('task/rabbit/switch-replacement');

// ---------------------------------------------------------------------------
// Upsert primitives
// ---------------------------------------------------------------------------

/** Insert or rewrite a row addressed by its natural key. */
async function put(trx: Knex.Transaction, table: string, keys: string[], row: Record<string, unknown>): Promise<void> {
  await trx(table).insert(row).onConflict(keys as never).merge();
}

/**
 * Insert a row once and leave it alone afterwards. Several co-managed evidence
 * tables carry BEFORE UPDATE triggers that reject every update by design, so an
 * upsert would fail on the second apply.
 */
async function putOnce(trx: Knex.Transaction, table: string, keys: string[], row: Record<string, unknown>): Promise<void> {
  await trx(table).insert(row).onConflict(keys as never).ignore();
}

/** Upsert for tables whose natural key has no unique index to conflict on. */
async function ensure(trx: Knex.Transaction, table: string, where: Record<string, unknown>,
  row: Record<string, unknown>): Promise<void> {
  const found = await trx(table).where(where).first();
  if (found) await trx(table).where(where).update(row);
  else await trx(table).insert({ ...where, ...row });
}

/**
 * Delete every tenant-scoped row for a tenant, then the tenant itself. Tables
 * whose rows are still referenced are retried on the next pass, so the order is
 * discovered rather than hand-maintained.
 */
async function purgeTenant(trx: Knex.Transaction, tenant: string): Promise<void> {
  const { rows } = await trx.raw<{ rows: { table_name: string }[] }>(`
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant'
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'tenants'
     ORDER BY c.relname`);
  let remaining = rows.map(row => row.table_name);
  while (remaining.length) {
    const blocked: string[] = [];
    for (const table of remaining) {
      await trx.raw('SAVEPOINT purge_step');
      try {
        await trx(table).where({ tenant }).del();
        await trx.raw('RELEASE SAVEPOINT purge_step');
      } catch {
        await trx.raw('ROLLBACK TO SAVEPOINT purge_step');
        blocked.push(table);
      }
    }
    if (blocked.length === remaining.length) {
      throw new Error(`Cannot purge tenant ${tenant}; blocked by ${blocked.join(', ')}`);
    }
    remaining = blocked;
  }
  await trx('tenants').where({ tenant }).del();
}

// ---------------------------------------------------------------------------
// Capability area 1 — Pro sponsor seat pool
// ---------------------------------------------------------------------------

/**
 * The sponsoring MSP holds a purchased pool with headroom, one relationship with
 * spare seats, and one relationship whose every allocated seat is taken.
 *
 * The USD 11.49 monthly seat price is a repository constant
 * (CO_MANAGED_MONTHLY_SEAT_CENTS = 1149); this environment configures no
 * STRIPE_CO_MANAGED_USER_PRICE_ID, so the entitlement below is a local record
 * and not a live Stripe-backed subscription.
 */
async function seatPool(trx: Knex.Transaction): Promise<void> {
  await put(trx, 'co_managed_entitlements', ['tenant'], {
    tenant: OZ, source: 'hosted', source_reference: 'co-managed-fixtures/local-seat-pool', capacity: 12,
    signed_license: null, verified_at: CREATED, valid_until: VALID_UNTIL,
    lapse_started_at: null, read_only_after: null, revision: 1, updated_at: CREATED, source_version: 0,
  });
  await put(trx, 'co_managed_purchase_operations', ['tenant', 'operation_id'], {
    tenant: OZ, operation_id: id('purchase/oz/pool'), quantity: 12, state: 'completed',
    provider_reference: 'local-record-no-stripe', created_at: CREATED, updated_at: CREATED,
  });
  // Relationship with headroom: four seats, three occupied.
  await trx('co_managed_allocations').where({ tenant: OZ, allocation_id: RABBIT_ALLOCATION })
    .update({ seats: 4, state: 'active', updated_at: CREATED });
  await trx('tenants').where({ tenant: RABBIT }).update({ licensed_user_count: 4 });
  // Relationship at its ceiling: two seats, two occupied.
  await put(trx, 'co_managed_allocations', ['tenant', 'allocation_id'], {
    tenant: OZ, allocation_id: MUNCHKIN_ALLOCATION, operation_id: MUNCHKIN_PROVISIONING,
    request_fingerprint: fingerprint('allocation/munchkin'), customer_tenant: MUNCHKIN,
    relationship_id: MUNCHKIN_RELATIONSHIP, seats: 2, state: 'active', released_at: null,
    created_at: CREATED, updated_at: CREATED,
  });
}

// ---------------------------------------------------------------------------
// The second customer workspace
// ---------------------------------------------------------------------------

async function sponsorClientRecord(trx: Knex.Transaction): Promise<void> {
  await put(trx, 'clients', ['tenant', 'client_id'], {
    tenant: OZ, client_id: OZ_MUNCHKIN_CLIENT, client_name: 'Munchkin Country', client_type: 'company',
    is_inactive: false, is_tax_exempt: false, billing_cycle: 'monthly', default_currency_code: 'USD',
    lifecycle_status: 'active', created_at: CREATED, updated_at: CREATED,
  });
  await put(trx, 'client_locations', ['location_id', 'tenant'], {
    tenant: OZ, location_id: id('location/oz/munchkin'), client_id: OZ_MUNCHKIN_CLIENT,
    location_name: 'Main Office', address_line1: '1 Yellow Brick Road', city: 'Munchkin Country',
    country_code: 'US', country_name: 'United States', is_default: true, is_active: true,
    created_at: CREATED, updated_at: CREATED,
  });
}

/**
 * Build the at-ceiling customer workspace the same way the product does: the
 * onboarding seed engine for roles and permissions, the standard board status
 * seeder for ticket statuses, and the standard priority catalogue.
 */
async function munchkinWorkspace(trx: Knex.Transaction, runOnboardingSeeds: RunOnboardingSeeds,
  seedBoardTicketStatusesFromStandards: SeedBoardStatuses): Promise<void> {
  const fresh = !(await trx('tenants').where({ tenant: MUNCHKIN }).first());
  await put(trx, 'tenants', ['tenant'], {
    tenant: MUNCHKIN, client_name: 'Munchkin Country IT', email: 'cm.munchkin.admin@munchkin.test',
    plan: 'pro', product_code: 'co_managed', billing_source: 'manual', licensed_user_count: 2,
    created_at: CREATED, updated_at: CREATED,
  });
  await put(trx, 'clients', ['tenant', 'client_id'], {
    tenant: MUNCHKIN, client_id: MUNCHKIN_SELF_CLIENT, client_name: 'Munchkin Country IT', client_type: 'company',
    is_inactive: false, is_tax_exempt: false, billing_cycle: 'monthly', default_currency_code: 'USD',
    lifecycle_status: 'active', created_at: CREATED, updated_at: CREATED,
  });
  await put(trx, 'client_locations', ['location_id', 'tenant'], {
    tenant: MUNCHKIN, location_id: id('location/munchkin/self'), client_id: MUNCHKIN_SELF_CLIENT,
    location_name: 'Main Office', address_line1: '1 Yellow Brick Road', city: 'Munchkin Country',
    country_code: 'US', country_name: 'United States', is_default: true, is_active: true,
    created_at: CREATED, updated_at: CREATED,
  });
  await put(trx, 'tenant_companies', ['tenant', 'client_id'], {
    tenant: MUNCHKIN, client_id: MUNCHKIN_SELF_CLIENT, is_default: true, created_at: CREATED, updated_at: CREATED,
  });
  await ensure(trx, 'tenant_email_settings', { tenant: MUNCHKIN },
    { email_provider: 'resend', fallback_enabled: true, tracking_enabled: false, created_at: CREATED, updated_at: CREATED });
  await put(trx, 'tenant_settings', ['tenant'], {
    tenant: MUNCHKIN, onboarding_completed: true, onboarding_completed_at: CREATED, onboarding_skipped: false,
    settings: JSON.stringify({ timezone: 'UTC' }), created_at: CREATED, updated_at: CREATED,
  });
  // Surrogate keys are derived rather than defaulted to gen_random_uuid(), so
  // these rows are byte-stable across a reset-and-reapply cycle.
  for (const [settings, catalogue, catalogueKey, key, surrogate] of [
    ['tenant_notification_category_settings', 'notification_categories', 'id', 'category_id',
      'tenant_notification_category_setting_id'],
    ['tenant_notification_subtype_settings', 'notification_subtypes', 'id', 'subtype_id',
      'tenant_notification_subtype_setting_id'],
    ['tenant_internal_notification_category_settings', 'internal_notification_categories',
      'internal_notification_category_id', 'category_id', 'tenant_internal_notification_category_setting_id'],
    ['tenant_internal_notification_subtype_settings', 'internal_notification_subtypes',
      'internal_notification_subtype_id', 'subtype_id', 'tenant_internal_notification_subtype_setting_id'],
  ] as const) {
    const catalogueRows = await trx(catalogue).select(catalogueKey);
    for (const row of catalogueRows) {
      await put(trx, settings, ['tenant', key], {
        tenant: MUNCHKIN, [key]: row[catalogueKey], [surrogate]: id(`${settings}/munchkin/${row[catalogueKey]}`),
        is_enabled: true, is_default_enabled: true, created_at: CREATED, updated_at: CREATED,
      });
    }
  }
  if (fresh) {
    await runOnboardingSeeds(MUNCHKIN, 'co_managed', { transaction: trx, log: SILENT });
  }
  await put(trx, 'boards', ['tenant', 'board_id'], {
    tenant: MUNCHKIN, board_id: MUNCHKIN_BOARD, board_name: 'Service Desk', is_default: true,
    is_inactive: false, display_order: 0,
  });
  await seedBoardTicketStatusesFromStandards(trx, MUNCHKIN, MUNCHKIN_BOARD, null);
  const standardPriorities = await trx('standard_priorities')
    .where({ item_type: 'ticket', is_itil_standard: false }).orderBy('order_number');
  for (const priority of standardPriorities) {
    await put(trx, 'priorities', ['tenant', 'priority_id'], {
      tenant: MUNCHKIN, priority_id: id(`priority/munchkin/${priority.priority_name}`),
      priority_name: priority.priority_name, order_number: priority.order_number, color: priority.color,
      item_type: 'ticket', created_by: null, created_at: CREATED, updated_at: CREATED,
    });
  }
  await put(trx, 'next_number', ['tenant', 'entity_type'], {
    tenant: MUNCHKIN, entity_type: 'TICKET', prefix: '', padding_length: 6, last_number: 0, initial_value: 1,
  });
  await put(trx, 'contacts', ['tenant', 'contact_name_id'], {
    tenant: MUNCHKIN, contact_name_id: id('contact/munchkin/admin'), client_id: MUNCHKIN_SELF_CLIENT,
    full_name: 'Nara Osei', email: 'cm.munchkin.admin@munchkin.test', role: 'IT Administrator',
    is_inactive: false, created_at: CREATED, updated_at: CREATED,
  });
}

/**
 * Relationship and sponsor-side provisioning record for the at-ceiling
 * workspace. Seat admission requires the provisioning operation to stay in
 * pending_acceptance for the life of the relationship, matching the live rows
 * this environment already carries.
 */
async function munchkinRelationship(trx: Knex.Transaction): Promise<void> {
  const administrator = byslug('user/munchkin/admin');
  await put(trx, 'co_management_relationships', ['tenant', 'relationship_id'], {
    tenant: MUNCHKIN, relationship_id: MUNCHKIN_RELATIONSHIP, sponsor_tenant: OZ,
    sponsor_client_id: OZ_MUNCHKIN_CLIENT, state: 'active', visibility_mode: 'board_scope', revision: 2,
    accepted_by: administrator.userId, accepted_at: CREATED, ended_at: null,
    created_at: CREATED, updated_at: CREATED, escalation_board_id: OZ_ESCALATION_BOARD,
  });
  await put(trx, 'co_management_board_scopes', ['tenant', 'relationship_id', 'board_id'], {
    tenant: MUNCHKIN, relationship_id: MUNCHKIN_RELATIONSHIP, board_id: MUNCHKIN_BOARD,
    can_collaborate: true, created_at: CREATED,
  });
  await put(trx, 'co_managed_provisioning_operations', ['tenant', 'operation_id'], {
    tenant: OZ, operation_id: MUNCHKIN_PROVISIONING, allocation_id: MUNCHKIN_ALLOCATION,
    customer_tenant: MUNCHKIN, relationship_id: MUNCHKIN_RELATIONSHIP,
    requested_by: byslug('user/oz/admin').userId, escalation_board_id: OZ_ESCALATION_BOARD,
    customer_board_id: MUNCHKIN_BOARD, customer_client_id: MUNCHKIN_SELF_CLIENT,
    administrator_invitation_id: id('invitation/munchkin/admin'),
    request_fingerprint: fingerprint('provisioning/munchkin'),
    request: JSON.stringify({ seats: 2, clientId: OZ_MUNCHKIN_CLIENT, workspaceName: 'Munchkin Country IT',
      visibilityMode: 'board_scope', escalationBoardId: OZ_ESCALATION_BOARD,
      administrator: { email: administrator.email, firstName: administrator.firstName, lastName: administrator.lastName } }),
    state: 'pending_acceptance', step: 'administrator_invitation', error_code: null,
    created_at: CREATED, updated_at: CREATED, invitation_sent_at: CREATED, invitation_delivery_error: null,
  });
  const adminRole = await trx('roles').where({ tenant: MUNCHKIN, role_name: 'Admin', msp: true, client: false }).first();
  if (!adminRole) throw new Error('Munchkin administrator role is missing; onboarding seeds did not run');
  // Consumed invitation: a used invitation reserves no seat, so the ceiling is
  // exactly the two active technicians.
  await put(trx, 'user_invitations', ['tenant', 'invitation_id'], {
    tenant: MUNCHKIN, invitation_id: id('invitation/munchkin/admin'), email: administrator.email,
    first_name: administrator.firstName, last_name: administrator.lastName, role_id: adminRole.role_id,
    token: fingerprint('invitation-token/munchkin/admin'), expires_at: at(-24 * 29), used_at: at(-24 * 29.5),
    created_at: CREATED,
    metadata: JSON.stringify({ co_managed_initial_admin: true, co_managed_relationship_id: MUNCHKIN_RELATIONSHIP,
      sponsor_tenant: OZ, invited_by_user_id: byslug('user/oz/admin').userId }),
  });
}

// ---------------------------------------------------------------------------
// Fixture users
// ---------------------------------------------------------------------------

async function fixtureUsers(trx: Knex.Transaction, secret: string): Promise<void> {
  for (const user of USERS) {
    const role = await trx('roles')
      .where({ tenant: user.tenant, role_name: user.roleName, msp: true, client: false }).first();
    if (!role) throw new Error(`Role ${user.roleName} is missing in tenant ${user.tenant}`);
    await put(trx, 'users', ['tenant', 'user_id'], {
      tenant: user.tenant, user_id: user.userId, username: user.email, email: user.email,
      first_name: user.firstName, last_name: user.lastName,
      hashed_password: deterministicPassword(user.slug, user.password, secret),
      user_type: 'internal', auth_method: 'password', is_inactive: false, two_factor_enabled: false,
      is_google_user: false, created_at: CREATED, updated_at: CREATED,
    });
    await put(trx, 'user_roles', ['tenant', 'user_id', 'role_id'], {
      tenant: user.tenant, user_id: user.userId, role_id: role.role_id, created_at: CREATED,
    });
  }
  // The MSP staff who may work each relationship.
  for (const customer of [{ tenant: RABBIT, relationship: RABBIT_RELATIONSHIP },
    { tenant: MUNCHKIN, relationship: MUNCHKIN_RELATIONSHIP }]) {
    for (const slug of ['user/oz/admin', 'user/oz/tech']) {
      await put(trx, 'co_management_staff_assignments',
        ['tenant', 'customer_tenant', 'relationship_id', 'principal_type', 'principal_id'], {
          tenant: OZ, customer_tenant: customer.tenant, relationship_id: customer.relationship,
          principal_type: 'user', principal_id: byslug(slug).userId, relationship_role: 'technician',
          created_at: CREATED,
        });
    }
  }
}

/** Cross-organization attribution rows, so shared history is org-qualified. */
async function actorReferences(trx: Knex.Transaction): Promise<void> {
  for (const [hostTenant, slug] of [[RABBIT, 'user/oz/tech'], [RABBIT, 'user/oz/admin']] as const) {
    const user = byslug(slug);
    await put(trx, 'collaboration_actor_references', ['tenant', 'actor_reference_id'], {
      tenant: hostTenant, actor_reference_id: id(`actor-reference/${hostTenant}/${slug}`),
      actor_tenant: user.tenant, actor_user_id: user.userId,
      display_name: `${user.firstName} ${user.lastName}`, organization_name: user.organization,
      created_at: CREATED, updated_at: CREATED,
    });
  }
}

const actorReference = (hostTenant: string, slug: string): string => id(`actor-reference/${hostTenant}/${slug}`);

// ---------------------------------------------------------------------------
// Reference-data lookups against workspaces this fixture does not own
// ---------------------------------------------------------------------------

async function priorityId(trx: Knex.Transaction, tenant: string, name: string): Promise<string> {
  const row = await trx('priorities').where({ tenant, priority_name: name, item_type: 'ticket' }).first('priority_id');
  if (!row) throw new Error(`Priority ${name} is missing in tenant ${tenant}`);
  return row.priority_id;
}

async function statusId(trx: Knex.Transaction, tenant: string, name: string, itemType: string): Promise<string> {
  const row = await trx('statuses').where({ tenant, name, item_type: itemType }).first('status_id');
  if (!row) throw new Error(`Status ${name} (${itemType}) is missing in tenant ${tenant}`);
  return row.status_id;
}

// ---------------------------------------------------------------------------
// Capability area 2 — escalation with independent MSP SLA timing
// ---------------------------------------------------------------------------

/** White Rabbit priority name -> the Oz priority the MSP measures it against. */
const MSP_PRIORITY_BY_CUSTOMER_PRIORITY: Record<string, string> = {
  Low: 'P4 - Low',
  Medium: 'P3 - Medium',
  High: 'P2 - High',
  Urgent: 'P1 - Critical',
  Critical: 'P1 - Critical',
};

/**
 * Two tickets on the shared board: one still customer-handled and ready for the
 * reviewer to escalate, and one already escalated whose MSP obligation clock
 * starts at the handoff rather than at ticket creation. Escalating the first
 * ticket therefore never destroys the already-escalated evidence.
 */
async function escalation(trx: Knex.Transaction, startObligation: StartObligation): Promise<void> {
  const rabbitPolicy = id('sla-policy/rabbit/service-desk');
  const rabbitHigh = await priorityId(trx, RABBIT, 'High');
  const ozHigh = await priorityId(trx, OZ, MSP_PRIORITY_BY_CUSTOMER_PRIORITY.High);
  const open = await statusId(trx, RABBIT, 'Open', 'ticket');
  const inProgress = await statusId(trx, RABBIT, 'In Progress', 'ticket');
  const customerTech = byslug('user/rabbit/tech');
  const mspTech = byslug('user/oz/tech');

  // The customer's own end-to-end policy, and the MSP's independent one.
  await put(trx, 'sla_policies', ['tenant', 'sla_policy_id'], {
    tenant: RABBIT, sla_policy_id: rabbitPolicy, policy_name: 'White Rabbit end-to-end SLA',
    description: 'Customer end-to-end response and resolution, measured from ticket creation.',
    is_default: false, created_at: CREATED, updated_at: CREATED,
  });
  await put(trx, 'sla_policy_targets', ['tenant', 'target_id'], {
    tenant: RABBIT, target_id: id('sla-target/rabbit/high'), sla_policy_id: rabbitPolicy, priority_id: rabbitHigh,
    response_time_minutes: 240, resolution_time_minutes: 2880, is_24x7: true, created_at: CREATED, updated_at: CREATED,
  });
  await put(trx, 'sla_policies', ['tenant', 'sla_policy_id'], {
    tenant: OZ, sla_policy_id: SLA_POLICY, policy_name: 'Co-managed MSP escalation SLA',
    description: 'MSP response and resolution, measured from escalation rather than ticket creation.',
    is_default: false, created_at: CREATED, updated_at: CREATED,
  });
  await put(trx, 'sla_policy_targets', ['tenant', 'target_id'], {
    tenant: OZ, target_id: id('sla-target/oz/high'), sla_policy_id: SLA_POLICY, priority_id: ozHigh,
    response_time_minutes: 60, resolution_time_minutes: 480, is_24x7: true, created_at: CREATED, updated_at: CREATED,
  });
  // Saved priority mapping: every customer priority resolves to an MSP priority.
  // The two organizations name their priorities independently, which is exactly
  // why the mapping is stored per relationship rather than matched by name.
  for (const [customerName, mspName] of Object.entries(MSP_PRIORITY_BY_CUSTOMER_PRIORITY)) {
    await put(trx, 'co_managed_sla_priority_mappings',
      ['tenant', 'customer_tenant', 'relationship_id', 'customer_priority_id'], {
        tenant: OZ, customer_tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP,
        customer_priority_id: await priorityId(trx, RABBIT, customerName),
        msp_priority_id: await priorityId(trx, OZ, mspName),
      });
  }

  await put(trx, 'tickets', ['tenant', 'ticket_id'], {
    tenant: RABBIT, ticket_id: READY_TICKET, ticket_number: '000101',
    title: 'Branch VPN drops every afternoon (ready to escalate)',
    board_id: RABBIT_SERVICE_DESK, client_id: RABBIT_SELF_CLIENT, status_id: open, priority_id: rabbitHigh,
    entered_by: customerTech.userId, updated_by: customerTech.userId, assigned_to: customerTech.userId,
    entered_at: at(-24), updated_at: at(-24), is_closed: false, ticket_origin: 'internal',
    sla_policy_id: rabbitPolicy, sla_started_at: at(-24), sla_response_due_at: at(-20),
    sla_resolution_due_at: at(24), sla_total_pause_minutes: 0,
  });
  await put(trx, 'tickets', ['tenant', 'ticket_id'], {
    tenant: RABBIT, ticket_id: ESCALATED_TICKET, ticket_number: '000102',
    title: 'Mail flow stalled for the finance group (escalated to MSP)',
    board_id: RABBIT_SERVICE_DESK, client_id: RABBIT_SELF_CLIENT, status_id: inProgress, priority_id: rabbitHigh,
    entered_by: customerTech.userId, updated_by: customerTech.userId, assigned_to: customerTech.userId,
    entered_at: at(-120), updated_at: at(2), is_closed: false, ticket_origin: 'internal',
    // Customer clock: running since the ticket was raised, five days ago.
    sla_policy_id: rabbitPolicy, sla_started_at: at(-120), sla_response_due_at: at(-116),
    sla_response_at: at(-118), sla_response_met: true, sla_resolution_due_at: at(-72),
    sla_resolution_met: false, sla_total_pause_minutes: 0,
  });
  await put(trx, 'co_management_ticket_work', ['tenant', 'relationship_id', 'ticket_id'], {
    tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP, ticket_id: ESCALATED_TICKET, work_id: ESCALATED_WORK,
    revision: 1, responsibility: 'msp', can_collaborate: true, grant_revoked_at: null,
    first_escalated_at: at(2), last_transition_at: at(2),
  });
  await put(trx, 'co_management_ticket_handoffs', ['tenant', 'operation_id'], {
    tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP, ticket_id: ESCALATED_TICKET,
    operation_id: ESCALATION_OPERATION, revision: 1, transition: 'escalated',
    request_fingerprint: fingerprint('handoff/rabbit/already-escalated'), actor_tenant: RABBIT,
    actor_user_id: customerTech.userId, actor_name: `${customerTech.firstName} ${customerTech.lastName}`,
    actor_organization: 'White Rabbit', audience: 'shared_it', occurred_at: at(2),
    note: 'Exchange hybrid connector looks misconfigured on the MSP side. Handing responsibility to Oz; '
      + 'finance cannot send externally.',
  });
  await put(trx, 'co_managed_ticket_references', ['tenant', 'reference_id'], {
    tenant: OZ, reference_id: id('ticket-reference/rabbit/already-escalated'), customer_tenant: RABBIT,
    relationship_id: RABBIT_RELATIONSHIP, ticket_id: ESCALATED_TICKET, work_id: ESCALATED_WORK,
    client_id: OZ_RABBIT_CLIENT, board_id: OZ_ESCALATION_BOARD, assigned_to: mspTech.userId,
    assigned_team_id: null, created_at: at(2), updated_at: at(2),
  });
  // MSP obligation, started at the handoff by the product's own SLA engine.
  await startObligation(trx,
    { tenant: OZ, obligationId: SLA_OBLIGATION, sourceTenant: RABBIT, ticketId: ESCALATED_TICKET },
    SLA_START_OPERATION,
    { workId: ESCALATED_WORK, generation: 1, policyId: SLA_POLICY, priorityId: ozHigh,
      schedule: { timezone: 'UTC', is_24x7: true, entries: [], holidays: [] },
      targets: { responseMinutes: 60, resolutionMinutes: 480 }, occurredAt: ISO(2) });
}

// ---------------------------------------------------------------------------
// Capability area 3 — private notes stay within the authoring organization
// ---------------------------------------------------------------------------

/**
 * Three notes on the escalated ticket: one shared between both IT teams, one
 * private to the customer, and one private to the MSP. Signing in as each side
 * shows a different subset.
 */
async function notes(trx: Knex.Transaction): Promise<void> {
  const mspTech = byslug('user/oz/tech');
  const customerTech = byslug('user/rabbit/tech');

  const sharedThread = id('thread/rabbit/shared-it');
  const sharedComment = id('comment/rabbit/shared-it');
  await put(trx, 'comment_threads', ['tenant', 'thread_id'], {
    tenant: RABBIT, thread_id: sharedThread, ticket_id: ESCALATED_TICKET, project_task_id: null,
    root_comment_id: sharedComment, is_internal: true, collaboration_audience: 'shared_it', reply_count: 0,
    last_activity_at: at(3), created_at: at(3), created_by: null,
  });
  await put(trx, 'comments', ['tenant', 'comment_id'], {
    tenant: RABBIT, comment_id: sharedComment, ticket_id: ESCALATED_TICKET, thread_id: sharedThread,
    user_id: null, contact_id: null, author_type: 'internal', is_internal: true, is_resolution: false,
    is_system_generated: false, publish_state: 'published',
    note: 'Shared IT note from Oz: the hybrid connector certificate expired on the transport server. '
      + 'Reissuing now; no action needed from White Rabbit.',
    markdown_content: 'Shared IT note from Oz: the hybrid connector certificate expired on the transport server. '
      + 'Reissuing now; no action needed from White Rabbit.',
    actor_reference_id: actorReference(RABBIT, 'user/oz/tech'),
    actor_display_name: `${mspTech.firstName} ${mspTech.lastName}`, actor_organization_name: 'Oz',
    created_at: at(3), updated_at: at(3), published_at: at(3),
  });

  const customerPrivateThread = id('thread/rabbit/customer-private');
  const customerPrivateComment = id('comment/rabbit/customer-private');
  await put(trx, 'comment_threads', ['tenant', 'thread_id'], {
    tenant: RABBIT, thread_id: customerPrivateThread, ticket_id: ESCALATED_TICKET, project_task_id: null,
    root_comment_id: customerPrivateComment, is_internal: true, collaboration_audience: 'organization_private',
    reply_count: 0, last_activity_at: at(4), created_at: at(4), created_by: customerTech.userId,
  });
  await put(trx, 'comments', ['tenant', 'comment_id'], {
    tenant: RABBIT, comment_id: customerPrivateComment, ticket_id: ESCALATED_TICKET,
    thread_id: customerPrivateThread, user_id: customerTech.userId, contact_id: null, author_type: 'internal',
    is_internal: true, is_resolution: false, is_system_generated: false, publish_state: 'published',
    note: 'White Rabbit private: hold the renewal conversation until this is closed. Do not share with Oz.',
    markdown_content: 'White Rabbit private: hold the renewal conversation until this is closed. Do not share with Oz.',
    actor_reference_id: null, actor_display_name: null, actor_organization_name: null,
    created_at: at(4), updated_at: at(4), published_at: at(4),
  });

  const mspPrivateThread = id('private-thread/oz/already-escalated');
  const mspPrivateComment = id('private-comment/oz/already-escalated');
  await put(trx, 'co_management_private_threads', ['tenant', 'thread_id'], {
    tenant: OZ, thread_id: mspPrivateThread, customer_tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP,
    resource_type: 'ticket', resource_id: ESCALATED_TICKET, root_comment_id: mspPrivateComment,
    created_at: at(5), last_activity_at: at(5), disclosure_operation_id: null,
  });
  await put(trx, 'co_management_private_comments', ['tenant', 'comment_id'], {
    tenant: OZ, comment_id: mspPrivateComment, thread_id: mspPrivateThread, parent_comment_id: null,
    actor_user_id: mspTech.userId, actor_display_name: `${mspTech.firstName} ${mspTech.lastName}`,
    actor_organization_name: 'Oz',
    note: 'Oz private: this is the third certificate lapse this year. Flag it for the account review '
      + 'before we quote the renewal.',
    markdown_content: 'Oz private: this is the third certificate lapse this year. Flag it for the account '
      + 'review before we quote the renewal.',
    created_at: at(5), updated_at: at(5), deleted_at: null, revision: 1,
  });
}

// ---------------------------------------------------------------------------
// Capability area 4 — MSP commercial time vs customer operational effort
// ---------------------------------------------------------------------------

/**
 * Both organizations record effort against the same shared ticket. The MSP entry
 * is commercial and billable in the MSP tenant; the customer entry is
 * operational, carries no billing attributes, and stays in the customer tenant.
 * The effort panel reads both and reports Customer, MSP and Combined.
 */
async function effort(trx: Knex.Transaction): Promise<void> {
  const mspTech = byslug('user/oz/tech');
  const customerTech = byslug('user/rabbit/tech');
  await put(trx, 'co_managed_time_work_references', ['tenant', 'reference_id'], {
    tenant: OZ, reference_id: TIME_REFERENCE, customer_tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP,
    source_kind: 'ticket', source_id: ESCALATED_TICKET, client_id: OZ_RABBIT_CLIENT, billing_profile_id: null,
    ticket_number: '000102', title: 'Mail flow stalled for the finance group (escalated to MSP)',
    description: 'Shared co-managed work item captured for MSP time capture.', captured_at: at(2),
  });
  // MSP commercial time, against the qualified shared work reference.
  await put(trx, 'time_entries', ['tenant', 'entry_id'], {
    tenant: OZ, entry_id: id('time-entry/oz/already-escalated'), user_id: mspTech.userId,
    work_item_id: TIME_REFERENCE, work_item_type: 'co_managed', co_managed_work_reference_id: TIME_REFERENCE,
    billing_mode: 'commercial', billable_duration: 90, start_time: at(3), end_time: at(4.5),
    work_date: at(3).toISOString().slice(0, 10), work_timezone: 'UTC', approval_status: 'DRAFT',
    notes: 'Reissued the hybrid connector certificate and reran mail flow validation.',
    created_by: mspTech.userId, updated_by: mspTech.userId, created_at: at(4.5), updated_at: at(4.5),
    invoiced: false,
  });
  // Customer operational effort: no billable duration, no billing attributes.
  await put(trx, 'time_entries', ['tenant', 'entry_id'], {
    tenant: RABBIT, entry_id: id('time-entry/rabbit/already-escalated'), user_id: customerTech.userId,
    work_item_id: ESCALATED_TICKET, work_item_type: 'ticket', co_managed_work_reference_id: null,
    billing_mode: 'operational', billable_duration: 0, start_time: at(0.5), end_time: at(1.25),
    work_date: at(0.5).toISOString().slice(0, 10), work_timezone: 'UTC', approval_status: 'DRAFT',
    notes: 'Collected message traces and confirmed the failure was outbound only before escalating.',
    created_by: customerTech.userId, updated_by: customerTech.userId, created_at: at(1.25), updated_at: at(1.25),
    invoiced: false,
  });
}

// ---------------------------------------------------------------------------
// Capability area 5 — export/upgrade and safe departure
// ---------------------------------------------------------------------------

/**
 * The live White Rabbit relationship is the one to export or upgrade from. The
 * Emerald City relationship is already terminated and sealed, so departure
 * evidence is inspectable without ending the live one. That closure is
 * re-sealed idempotently elsewhere and is never flipped back to active here.
 */
async function departure(trx: Knex.Transaction): Promise<string[]> {
  const notes: string[] = [];
  const closure = await trx('co_managed_relationship_closures')
    .where({ tenant: OZ, customer_tenant: EMERALD, relationship_id: EMERALD_RELATIONSHIP }).first();
  const manifest = await trx('co_managed_archive_manifests')
    .where({ tenant: OZ, customer_tenant: EMERALD, relationship_id: EMERALD_RELATIONSHIP }).first();
  const relationship = await trx('co_management_relationships')
    .where({ tenant: EMERALD, relationship_id: EMERALD_RELATIONSHIP }).first();
  if (!closure) notes.push('Emerald City closure record is absent');
  if (!manifest) notes.push('Emerald City sealed archive manifest is absent');
  if (relationship?.state !== 'terminated') notes.push(`Emerald City relationship is ${relationship?.state}, not terminated`);
  return notes;
}

/** Retained MSP evidence of the shared work it participated in. */
async function participationEvidence(trx: Knex.Transaction): Promise<void> {
  const mspTech = byslug('user/oz/tech');
  const customerTech = byslug('user/rabbit/tech');
  const entries = [
    { slug: 'evidence/handoff', sourceType: 'ticket_handoff', sourceId: ESCALATION_OPERATION,
      operationId: ESCALATION_OPERATION, eventType: 'ticket_escalated', actorTenant: RABBIT, actor: customerTech,
      occurredAt: at(2), payload: { transition: 'escalated', revision: 1, responsibility: 'msp' } },
    { slug: 'evidence/time', sourceType: 'time_entry', sourceId: id('time-entry/oz/already-escalated'),
      operationId: id('operation/oz/time-capture'), eventType: 'time_entry_recorded', actorTenant: OZ, actor: mspTech,
      occurredAt: at(4.5), payload: { billingMode: 'commercial', billableDuration: 90 } },
    { slug: 'evidence/conversation', sourceType: 'conversation', sourceId: id('comment/rabbit/shared-it'),
      operationId: id('operation/oz/shared-note'), eventType: 'ticket_comment_added', actorTenant: OZ, actor: mspTech,
      occurredAt: at(3), payload: { audience: 'shared_it' } },
  ] as const;
  for (const entry of entries) {
    const payload = { ...entry.payload, ticketId: ESCALATED_TICKET };
    await putOnce(trx, 'co_managed_participation_evidence', ['tenant', 'evidence_id'], {
      tenant: OZ, evidence_id: id(entry.slug), customer_tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP,
      resource_id: ESCALATED_TICKET, resource_type: 'ticket', client_id: OZ_RABBIT_CLIENT,
      source_type: entry.sourceType, source_id: entry.sourceId, operation_id: entry.operationId,
      event_type: entry.eventType, actor_tenant: entry.actorTenant, actor_kind: 'user',
      actor_user_id: entry.actor.userId, actor_contact_id: null,
      actor_name: `${entry.actor.firstName} ${entry.actor.lastName}`, actor_organization: entry.actor.organization,
      payload: JSON.stringify(payload), payload_hash: hashPayload(payload),
      occurred_at: entry.occurredAt, captured_at: entry.occurredAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Capability area 6 — delegated administration
// ---------------------------------------------------------------------------

/**
 * The MSP administrator holds one scoped customer-side delegation: board
 * settings on the shared Service Desk board. The customer's Executive board is
 * deliberately outside both the relationship scope and the delegation, so the
 * limit is demonstrable rather than asserted.
 */
async function delegation(trx: Knex.Transaction): Promise<void> {
  await put(trx, 'boards', ['tenant', 'board_id'], {
    tenant: RABBIT, board_id: PRIVATE_BOARD, board_name: 'Executive (private)', is_default: false,
    is_inactive: false, display_order: 10,
    description: 'Customer-only board. Deliberately outside the co-managed scope and every delegated grant.',
  });
  const relationship = await trx('co_management_relationships')
    .where({ tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP }).first('revision');
  await put(trx, 'co_management_delegated_grants', ['tenant', 'grant_id'], {
    tenant: RABBIT, grant_id: id('delegated-grant/rabbit/board-settings'), relationship_id: RABBIT_RELATIONSHIP,
    principal_type: 'user', principal_id: byslug('user/oz/admin').userId, operation: 'board_settings',
    // A board_settings grant carries no target fingerprint. saveCoManagedDelegatedGrant
    // stores whatever targetRecord() computes, and that is null for board_settings and
    // user_profile; only invitation_resend pins its terms with a hash. admitGrant() then
    // rejects any grant whose stored fingerprint differs from the recomputed one, so an
    // invented value here would make the grant invisible to the grantee. --verify proves
    // the grant is live by reading the MSP administrator's own delegated screen.
    target_id: RABBIT_SERVICE_DESK, target_fingerprint: null,
    approved_by: byslug('user/rabbit/admin').userId, approved_revision: relationship?.revision ?? 1,
    revoked_at: null, created_at: CREATED,
  });
}

// ---------------------------------------------------------------------------
// Capability area 7 — shared-history collaboration
// ---------------------------------------------------------------------------

/**
 * A customer-owned project explicitly shared with the MSP, one task both teams
 * work on, and a conversation carrying organization-qualified attribution from
 * each side.
 */
async function collaboration(trx: Knex.Transaction): Promise<void> {
  const mspTech = byslug('user/oz/tech');
  const customerTech = byslug('user/rabbit/tech');
  const projectStatus = await statusId(trx, RABBIT, 'In Progress', 'project');
  const taskStatus = await statusId(trx, RABBIT, 'In Progress', 'project_task');
  const phase = id('phase/rabbit/network-refresh');
  const mapping = id('status-mapping/rabbit/network-refresh');

  await put(trx, 'projects', ['tenant', 'project_id'], {
    tenant: RABBIT, project_id: SHARED_PROJECT, project_name: 'Branch network refresh',
    description: 'Customer-owned project, shared with Oz for joint delivery.',
    status: projectStatus, wbs_code: '1', client_id: RABBIT_SELF_CLIENT, project_number: 'PRJ-000101',
    start_date: at(-24 * 20), end_date: at(24 * 40), is_inactive: false,
    assigned_to: customerTech.userId, created_at: CREATED, updated_at: at(6),
  });
  await put(trx, 'project_status_mappings', ['tenant', 'project_status_mapping_id'], {
    tenant: RABBIT, project_status_mapping_id: mapping, project_id: SHARED_PROJECT, status_id: taskStatus,
    standard_status_id: null, custom_name: null, display_order: 1, is_visible: true, is_standard: false,
  });
  await put(trx, 'project_phases', ['tenant', 'phase_id'], {
    tenant: RABBIT, phase_id: phase, project_id: SHARED_PROJECT, phase_name: 'Edge hardware',
    status: 'In Progress', order_number: 1, wbs_code: '1.1', start_date: at(-24 * 20), end_date: at(24 * 20),
    created_at: CREATED, updated_at: at(6),
  });
  await put(trx, 'project_tasks', ['tenant', 'task_id'], {
    tenant: RABBIT, task_id: SHARED_TASK, phase_id: phase, task_name: 'Replace the distribution switch stack',
    description: 'Joint task: White Rabbit stages the hardware, Oz performs the cutover.',
    assigned_to: customerTech.userId, estimated_hours: 6, actual_hours: 2, wbs_code: '1.1.1',
    project_status_mapping_id: mapping, task_type_key: 'task', due_date: at(24 * 10),
    created_at: CREATED, updated_at: at(6),
  });
  await put(trx, 'co_management_project_scopes', ['tenant', 'relationship_id', 'project_id'], {
    tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP, project_id: SHARED_PROJECT,
    can_collaborate: true, created_at: CREATED,
  });
  await put(trx, 'co_managed_project_task_references', ['tenant', 'reference_id'], {
    tenant: OZ, reference_id: id('task-reference/oz/switch-replacement'), customer_tenant: RABBIT,
    relationship_id: RABBIT_RELATIONSHIP, task_id: SHARED_TASK, client_id: OZ_RABBIT_CLIENT,
    assigned_to: mspTech.userId, assigned_team_id: null, active: true, revision: 1,
    assignee_name: `${mspTech.firstName} ${mspTech.lastName}`, organization_name: 'Oz',
    task_name: 'Replace the distribution switch stack', project_name: 'Branch network refresh',
    created_at: CREATED, updated_at: at(6),
  });

  const taskThread = id('thread/rabbit/task');
  const customerNote = id('task-comment/rabbit/customer');
  const mspNote = id('task-comment/rabbit/msp');
  await put(trx, 'comment_threads', ['tenant', 'thread_id'], {
    tenant: RABBIT, thread_id: taskThread, ticket_id: null, project_task_id: SHARED_TASK,
    root_comment_id: customerNote, is_internal: true, collaboration_audience: 'shared_it', reply_count: 1,
    last_activity_at: at(7), created_at: at(6), created_by: customerTech.userId,
  });
  await put(trx, 'project_task_comments', ['tenant', 'task_comment_id'], {
    tenant: RABBIT, task_comment_id: customerNote, task_id: SHARED_TASK, thread_id: taskThread,
    parent_comment_id: null, user_id: customerTech.userId, author_type: 'internal',
    note: 'Hardware landed at the branch this morning; rack elevation is attached to the change record.',
    markdown_content: 'Hardware landed at the branch this morning; rack elevation is attached to the change record.',
    actor_reference_id: null, actor_display_name: null, actor_organization_name: null,
    collaboration_revision: 1, created_at: at(6), updated_at: at(6),
  });
  await put(trx, 'project_task_comments', ['tenant', 'task_comment_id'], {
    tenant: RABBIT, task_comment_id: mspNote, task_id: SHARED_TASK, thread_id: taskThread,
    parent_comment_id: customerNote, user_id: null, author_type: 'internal',
    note: 'Oz will take the cutover window on Saturday 22:00 UTC. Console access is already staged.',
    markdown_content: 'Oz will take the cutover window on Saturday 22:00 UTC. Console access is already staged.',
    actor_reference_id: actorReference(RABBIT, 'user/oz/tech'),
    actor_display_name: `${mspTech.firstName} ${mspTech.lastName}`, actor_organization_name: 'Oz',
    collaboration_revision: 1, created_at: at(7), updated_at: at(7),
  });
}

// ---------------------------------------------------------------------------
// Injected product engines
// ---------------------------------------------------------------------------

interface SeedLog { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
const SILENT: SeedLog = { info() {}, warn() {}, error() {} };

type RunOnboardingSeeds = (tenantId: string, productCode: string,
  options: { transaction: Knex.Transaction; log: SeedLog }) => Promise<unknown>;
type SeedBoardStatuses = (trx: Knex.Transaction, tenant: string, boardId: string, userId: string | null) => Promise<number>;
type StartObligation = (trx: Knex.Transaction,
  identity: { tenant: string; obligationId: string; sourceTenant: string; ticketId: string },
  operationId: string,
  input: { workId: string; generation: number; policyId: string; priorityId: string;
    schedule: { timezone: string; is_24x7: boolean; entries: unknown[]; holidays: unknown[] };
    targets: { responseMinutes: number; resolutionMinutes: number }; occurredAt: string }) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Apply / reset / verify
// ---------------------------------------------------------------------------

async function assertPreconditions(trx: Knex.Transaction): Promise<void> {
  const sponsor = await trx('tenants').where({ tenant: OZ }).first('product_code', 'plan');
  if (!sponsor) throw new Error(`Sponsoring MSP tenant ${OZ} is missing from this database`);
  if (sponsor.product_code !== 'psa' || sponsor.plan !== 'pro') {
    throw new Error(`Sponsor must be a Pro PSA tenant; found product_code=${sponsor.product_code} plan=${sponsor.plan}`);
  }
  for (const tenant of [RABBIT, EMERALD]) {
    if (!(await trx('tenants').where({ tenant }).first())) throw new Error(`Expected tenant ${tenant} is missing`);
  }
  const live = await trx('co_management_relationships')
    .where({ tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP }).first('state', 'ended_at');
  if (live?.state !== 'active') throw new Error(`White Rabbit relationship must be active; found ${live?.state}`);
}

async function apply(db: Knex, engines: { runOnboardingSeeds: RunOnboardingSeeds;
  seedBoardTicketStatusesFromStandards: SeedBoardStatuses; startObligation: StartObligation;
  verifyPassword: (password: string, stored: string) => Promise<boolean> }): Promise<void> {
  const secret = required('NEXTAUTH_SECRET');
  // Prove the deterministic hashes are the ones the application will accept.
  for (const user of USERS) {
    const stored = deterministicPassword(user.slug, user.password, secret);
    if (!(await engines.verifyPassword(user.password, stored))) {
      throw new Error(`Fixture password for ${user.email} is not accepted by the application verifier`);
    }
  }
  const departureNotes = await db.transaction(async trx => {
    await assertPreconditions(trx);
    await sponsorClientRecord(trx);
    await munchkinWorkspace(trx, engines.runOnboardingSeeds, engines.seedBoardTicketStatusesFromStandards);
    await fixtureUsers(trx, secret);
    await munchkinRelationship(trx);
    await seatPool(trx);
    await actorReferences(trx);
    await escalation(trx, engines.startObligation);
    await notes(trx);
    await effort(trx);
    await participationEvidence(trx);
    await delegation(trx);
    await collaboration(trx);
    return departure(trx);
  });
  for (const note of departureNotes) console.warn(`  departure evidence warning: ${note}`);
}

const FIXTURE_ROWS: { table: string; where: Record<string, unknown> }[] = [
  { table: 'co_managed_participation_evidence', where: { tenant: OZ, relationship_id: RABBIT_RELATIONSHIP } },
  { table: 'time_entries', where: { tenant: OZ, entry_id: id('time-entry/oz/already-escalated') } },
  { table: 'time_entries', where: { tenant: RABBIT, entry_id: id('time-entry/rabbit/already-escalated') } },
  { table: 'co_managed_time_work_references', where: { tenant: OZ, reference_id: TIME_REFERENCE } },
  { table: 'project_task_comments', where: { tenant: RABBIT, task_id: SHARED_TASK } },
  { table: 'co_managed_project_task_references', where: { tenant: OZ, task_id: SHARED_TASK } },
  { table: 'co_management_project_scopes', where: { tenant: RABBIT, project_id: SHARED_PROJECT } },
  { table: 'comment_threads', where: { tenant: RABBIT, project_task_id: SHARED_TASK } },
  { table: 'project_tasks', where: { tenant: RABBIT, task_id: SHARED_TASK } },
  { table: 'project_phases', where: { tenant: RABBIT, project_id: SHARED_PROJECT } },
  { table: 'project_status_mappings', where: { tenant: RABBIT, project_id: SHARED_PROJECT } },
  { table: 'projects', where: { tenant: RABBIT, project_id: SHARED_PROJECT } },
  { table: 'co_management_private_comments', where: { tenant: OZ, thread_id: id('private-thread/oz/already-escalated') } },
  { table: 'co_management_private_threads', where: { tenant: OZ, thread_id: id('private-thread/oz/already-escalated') } },
  { table: 'co_management_delegated_grants', where: { tenant: RABBIT, grant_id: id('delegated-grant/rabbit/board-settings') } },
  { table: 'sla_organization_events', where: { tenant: OZ, obligation_id: SLA_OBLIGATION } },
  { table: 'sla_organization_obligations', where: { tenant: OZ, obligation_id: SLA_OBLIGATION } },
  { table: 'co_managed_ticket_references', where: { tenant: OZ, ticket_id: ESCALATED_TICKET } },
  { table: 'co_management_ticket_handoffs', where: { tenant: RABBIT, ticket_id: ESCALATED_TICKET } },
  { table: 'co_management_ticket_work', where: { tenant: RABBIT, ticket_id: ESCALATED_TICKET } },
  { table: 'co_managed_sla_priority_mappings', where: { tenant: OZ, relationship_id: RABBIT_RELATIONSHIP } },
  { table: 'co_management_staff_assignments', where: { tenant: OZ, customer_tenant: RABBIT } },
  { table: 'co_management_staff_assignments', where: { tenant: OZ, customer_tenant: MUNCHKIN } },
  { table: 'co_managed_purchase_operations', where: { tenant: OZ, operation_id: id('purchase/oz/pool') } },
  { table: 'co_managed_allocations', where: { tenant: OZ, allocation_id: MUNCHKIN_ALLOCATION } },
  { table: 'co_managed_provisioning_operations', where: { tenant: OZ, operation_id: MUNCHKIN_PROVISIONING } },
];

async function reset(db: Knex): Promise<void> {
  await db.transaction(async trx => {
    // Comments and threads first: tickets and search rows depend on them.
    for (const ticket of [READY_TICKET, ESCALATED_TICKET]) {
      await trx('comments').where({ tenant: RABBIT, ticket_id: ticket }).del();
      await trx('comment_threads').where({ tenant: RABBIT, ticket_id: ticket }).del();
    }
    await trx('app_search_index').where({ tenant: RABBIT })
      .whereIn('object_id', [READY_TICKET, ESCALATED_TICKET, SHARED_PROJECT, SHARED_TASK]).del();
    for (const row of FIXTURE_ROWS) await trx(row.table).where(row.where).del();
    await trx('tickets').where({ tenant: RABBIT }).whereIn('ticket_id', [READY_TICKET, ESCALATED_TICKET]).del();
    await trx('sla_policy_targets').where({ tenant: RABBIT, sla_policy_id: id('sla-policy/rabbit/service-desk') }).del();
    await trx('sla_policies').where({ tenant: RABBIT, sla_policy_id: id('sla-policy/rabbit/service-desk') }).del();
    await trx('sla_policy_targets').where({ tenant: OZ, sla_policy_id: SLA_POLICY }).del();
    await trx('sla_policies').where({ tenant: OZ, sla_policy_id: SLA_POLICY }).del();
    await trx('boards').where({ tenant: RABBIT, board_id: PRIVATE_BOARD }).del();
    await trx('collaboration_actor_references').where({ tenant: RABBIT })
      .whereIn('actor_reference_id', [actorReference(RABBIT, 'user/oz/tech'), actorReference(RABBIT, 'user/oz/admin')]).del();
    const fixtureUserIds = USERS.filter(user => user.tenant !== MUNCHKIN).map(user => user.userId);
    await trx('user_roles').whereIn('user_id', fixtureUserIds).del();
    await trx('users').whereIn('user_id', fixtureUserIds).del();

    if (await trx('tenants').where({ tenant: MUNCHKIN }).first()) await purgeTenant(trx, MUNCHKIN);
    await trx('client_locations').where({ tenant: OZ, client_id: OZ_MUNCHKIN_CLIENT }).del();
    await trx('clients').where({ tenant: OZ, client_id: OZ_MUNCHKIN_CLIENT }).del();

    // Restore the pre-fixture sponsor pool.
    await trx('co_managed_entitlements').where({ tenant: OZ }).update({
      capacity: BASELINE.entitlementCapacity, source_reference: BASELINE.entitlementSourceReference,
      valid_until: BASELINE.entitlementValidUntil,
    });
    await trx('co_managed_allocations').where({ tenant: OZ, allocation_id: RABBIT_ALLOCATION })
      .update({ seats: BASELINE.rabbitAllocationSeats });
    await trx('tenants').where({ tenant: RABBIT }).update({ licensed_user_count: BASELINE.rabbitAllocationSeats });
  });
}

/**
 * Run a capability probe against the product's own engines and discard whatever
 * it wrote. A verify must never leave a trace, and several of these engines
 * insist on an open transaction, so every probe gets one and it always rolls
 * back.
 */
async function probe<T>(db: Knex, work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  let result!: T;
  await db.transaction(async trx => {
    result = await work(trx);
    throw new Error('fixture-probe-rollback');
  }).catch((error: Error) => { if (error.message !== 'fixture-probe-rollback') throw error; });
  return result;
}

/**
 * A live session for a fixture user, so a probe can enter the session-scoped
 * read paths a reviewer actually uses. Only valid inside probe(): the session
 * row disappears with the rollback.
 */
async function verifySession(trx: Knex.Transaction, slug: string):
  Promise<{ kind: 'session'; tenant: string; userId: string; sessionId: string }> {
  const user = byslug(slug);
  const sessionId = id(`verify-session/${slug}`);
  await trx('sessions').insert({
    tenant: user.tenant, session_id: sessionId, user_id: user.userId, token: fingerprint(`verify-session/${slug}`),
    created_at: trx.fn.now(), last_activity_at: trx.fn.now(), login_method: 'password',
    expires_at: trx.raw("clock_timestamp() + interval '5 minutes'"),
  });
  return { kind: 'session', tenant: user.tenant, userId: user.userId, sessionId };
}

function say(ok: boolean, area: string, detail: string): void {
  if (!ok) process.exitCode = 1;
  console.log(`${(ok ? 'present' : 'MISMATCH').padEnd(8)} ${area.padEnd(17)} ${detail}`);
}

async function verify(db: Knex): Promise<void> {
  const report: [string, string, Record<string, unknown>][] = [];
  const add = async (area: string, label: string, table: string, where: Record<string, unknown>) => {
    const rows = await db(table).where(where);
    report.push([area, `${label} (${table})`, { matched: rows.length, ...where }]);
  };
  await add('1 seat pool', 'sponsor entitlement', 'co_managed_entitlements', { tenant: OZ });
  await add('1 seat pool', 'allocation with headroom', 'co_managed_allocations', { tenant: OZ, allocation_id: RABBIT_ALLOCATION });
  await add('1 seat pool', 'allocation at ceiling', 'co_managed_allocations', { tenant: OZ, allocation_id: MUNCHKIN_ALLOCATION });
  await add('2 escalation', 'ticket ready to escalate', 'tickets', { tenant: RABBIT, ticket_id: READY_TICKET });
  await add('2 escalation', 'escalated ticket work', 'co_management_ticket_work', { tenant: RABBIT, ticket_id: ESCALATED_TICKET });
  await add('2 escalation', 'MSP SLA obligation', 'sla_organization_obligations', { tenant: OZ, obligation_id: SLA_OBLIGATION });
  await add('2 escalation', 'priority mapping', 'co_managed_sla_priority_mappings', { tenant: OZ, relationship_id: RABBIT_RELATIONSHIP });
  await add('3 notes', 'shared IT note', 'comments', { tenant: RABBIT, comment_id: id('comment/rabbit/shared-it') });
  await add('3 notes', 'MSP private note', 'co_management_private_comments', { tenant: OZ, comment_id: id('private-comment/oz/already-escalated') });
  await add('4 effort', 'MSP commercial time', 'time_entries', { tenant: OZ, entry_id: id('time-entry/oz/already-escalated') });
  await add('4 effort', 'customer operational time', 'time_entries', { tenant: RABBIT, entry_id: id('time-entry/rabbit/already-escalated') });
  await add('5 departure', 'live relationship to export', 'co_management_relationships', { tenant: RABBIT, relationship_id: RABBIT_RELATIONSHIP });
  await add('5 departure', 'sealed archive manifest', 'co_managed_archive_manifests', { tenant: OZ, customer_tenant: EMERALD });
  await add('5 departure', 'closure record', 'co_managed_relationship_closures', { tenant: OZ, customer_tenant: EMERALD });
  await add('6 delegation', 'scoped grant', 'co_management_delegated_grants', { tenant: RABBIT, grant_id: id('delegated-grant/rabbit/board-settings') });
  await add('6 delegation', 'out-of-scope private board', 'boards', { tenant: RABBIT, board_id: PRIVATE_BOARD });
  await add('7 collaboration', 'shared project scope', 'co_management_project_scopes', { tenant: RABBIT, project_id: SHARED_PROJECT });
  await add('7 collaboration', 'shared task reference', 'co_managed_project_task_references', { tenant: OZ, task_id: SHARED_TASK });
  await add('7 collaboration', 'cross-org task comments', 'project_task_comments', { tenant: RABBIT, task_id: SHARED_TASK });

  // Prove the seat headroom and the seat ceiling through the product's own
  // admission engine rather than by reading the numbers back out of the rows.
  const { getCoManagedEntitlementState } = await import(`${REPO_ROOT}/packages/licensing/src/lib/co-managed-entitlements.js`);
  const { assertCoManagedSeatAdmission } = await import(`${REPO_ROOT}/packages/licensing/src/lib/co-managed-admission.js`);
  const pool = await getCoManagedEntitlementState(db, OZ);
  console.log(`\nsponsor pool: capacity=${pool.capacity} allocated=${pool.allocated} `
    + `available=${pool.available} canGrow=${pool.canGrow}\n`);
  for (const [label, tenant, expectation] of [
    ['White Rabbit', RABBIT, 'admitted'], ['Munchkin Country', MUNCHKIN, 'CO_MANAGED_SEAT_LIMIT'],
  ] as const) {
    const outcome = await probe(db, async trx => {
      try {
        await assertCoManagedSeatAdmission(trx, tenant, { email: 'probe.newhire@example.test', kind: 'invitation' });
        return 'admitted';
      } catch (error) {
        return (error as { code?: string }).code ?? String(error);
      }
    });
    say(outcome === expectation, '1 seat pool', `${label} seat admission -> ${outcome} (expected ${expectation})`);
  }

  // Prove the delegation is live the way its grantee meets it: on the MSP
  // administrator's own delegated screen. A grant row can exist and still be
  // inert -- admitGrant() drops any grant whose stored target fingerprint does
  // not match the one it recomputes -- so reading the row proves nothing.
  // After --reset the MSP administrator is gone, so the screen cannot be
  // opened at all; report that rather than dying on the way to the row list.
  const { getCoManagedDelegatedScreen } = await import(`${REPO_ROOT}/packages/co-managed/src/delegatedAdministration.js`);
  type DelegatedGrant = { grantId: string; targetId: string; label?: string; operation?: string; available?: boolean };
  const grants = await probe<DelegatedGrant[] | null>(db, async trx => {
    try {
      const actor = await verifySession(trx, 'user/oz/admin');
      const screen = await getCoManagedDelegatedScreen(trx, actor, { customerTenant: RABBIT, relationshipId: RABBIT_RELATIONSHIP });
      return screen.grants as DelegatedGrant[];
    } catch {
      return null;
    }
  });
  const grant = grants?.find(row => row.grantId === id('delegated-grant/rabbit/board-settings'));
  say(Boolean(grant?.available) && grant?.targetId === RABBIT_SERVICE_DESK, '6 delegation',
    `MSP administrator's delegated screen -> ${grant?.available ? `${grant.label} (${grant.operation})`
      : grants ? 'grant not offered' : 'unavailable to cm.msp.admin@oz.test'}`);
  const privateBoard = Boolean(grants?.some(row => row.targetId === PRIVATE_BOARD));
  say(!privateBoard, '6 delegation',
    `Executive (private) board -> ${privateBoard ? 'REACHABLE by the MSP' : 'out of the MSP administrator\'s reach'}`);
  console.log('');

  let missing = 0;
  for (const [area, label, detail] of report) {
    const matched = Number(detail.matched);
    if (!matched) missing += 1;
    console.log(`${matched ? 'present' : 'MISSING'}  ${area.padEnd(17)} ${label}`);
  }
  console.log(`\n${report.length - missing}/${report.length} fixture checks present.`);
  if (missing) process.exitCode = 1;
}

async function main(): Promise<void> {
  const mode = process.argv.includes('--reset') ? 'reset' : process.argv.includes('--verify') ? 'verify' : 'apply';
  const db = knexFactory({ client: 'pg', connection: CONNECTION, pool: { min: 0, max: 4 } });
  try {
    if (mode === 'verify') {
      await verify(db);
    } else if (mode === 'reset') {
      await reset(db);
      console.log('Co-managed fixtures removed; sponsor pool restored to its pre-fixture baseline.');
    } else {
      const [{ runOnboardingSeeds }, { seedBoardTicketStatusesFromStandards }, { startOrganizationSlaObligation },
        { verifyPassword }] = await Promise.all([
        import(`${REPO_ROOT}/ee/temporal-workflows/src/db/onboarding-seeds-operations.js`),
        import(`${REPO_ROOT}/shared/lib/boardTicketDefaults.js`),
        import(`${REPO_ROOT}/shared/lib/sla/organizationSlaStore.js`),
        import(`${REPO_ROOT}/shared/utils/encryption.js`),
      ]);
      await apply(db, { runOnboardingSeeds, seedBoardTicketStatusesFromStandards,
        startObligation: startOrganizationSlaObligation, verifyPassword });
      console.log('Co-managed fixtures applied.');
    }
  } finally {
    await db.destroy();
  }
}

await main();
