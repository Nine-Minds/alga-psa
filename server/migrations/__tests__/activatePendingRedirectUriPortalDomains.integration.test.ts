import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knexFactory, { type Knex } from 'knex';

/**
 * T007 (alga-2026-0002996): the data migration that retires the redirect-URI gate.
 *
 * Self-contained: builds the portal_domains shape in a scratch schema (so it never touches
 * the shared test database's data) and, when the Citus extension is present, distributes it
 * by tenant as production does, so the multi-shard UPDATE rules are exercised for real.
 * Connection settings follow the standard DB_* variables.
 */

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20261117120000_activate_pending_redirect_uri_portal_domains.cjs')) as {
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
};

const SCHEMA = `pd_mig_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const HOSTED_LIVE_MESSAGE = 'Your domain is live and protected by HTTPS.';
const STALE = new Date('2020-01-01T00:00:00Z');

let db: Knex;
let distributed = false;

type Seed = {
  key: string;
  status: string;
  details: Record<string, unknown>;
  message?: string;
};

const T1 = randomUUID();
const T2 = randomUUID();
const T3 = randomUUID();
const T4 = randomUUID();
const T5 = randomUUID();

const seeds: Array<Seed & { tenant: string; domain: string }> = [
  {
    key: 'hostedPending', tenant: T1, domain: 'msp.hosted.test', status: 'pending_redirect_uri', message: 'Register these SSO redirect URIs …',
    details: { expected_cname: 'x.portal.test', sso_redirect_uris: { required: ['u'], confirmed: [] } },
  },
  {
    key: 'applianceWithGate', tenant: T2, domain: 'msp.appliance.test', status: 'pending_redirect_uri', message: 'waiting',
    details: { proxy_target_host: 'app.local', sso_redirect_uris: { required: ['u'], confirmed: [] } },
  },
  {
    key: 'activeWithLegacyDetails', tenant: T3, domain: 'both.active.test', status: 'active', message: 'kept',
    details: { expected_cname: 'y.portal.test', sso_redirect_uris: { required: ['u'], confirmed: ['u'] } },
  },
  { key: 'dnsPending', tenant: T4, domain: 'pending.dns.test', status: 'pending_dns', message: 'Waiting for DNS', details: { expected_cname: 'z' } },
  { key: 'dnsFailed', tenant: T5, domain: 'failed.dns.test', status: 'dns_failed', message: 'nope', details: { sso_redirect_uris: { required: [] } } },
];

async function rowFor(key: string) {
  const seed = seeds.find((s) => s.key === key)!;
  return db('portal_domains').where({ tenant: seed.tenant, domain: seed.domain }).first();
}

beforeAll(async () => {
  db = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN || 'postpass123',
      database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'postgres',
    },
    searchPath: [SCHEMA, 'public'],
    pool: { min: 1, max: 1 },
  });

  await db.raw(`CREATE SCHEMA ${SCHEMA}`);
  await db.raw(`SET search_path TO ${SCHEMA}, public`);
  await db.raw(`CREATE TYPE ${SCHEMA}.portal_domain_status AS ENUM (
    'pending_dns','verifying_dns','dns_failed','pending_certificate','certificate_issuing',
    'certificate_failed','deploying','pending_redirect_uri','active','disabled')`);
  // Same columns the migration touches; tenant is part of the primary key as on a distributed table.
  await db.raw(`CREATE TABLE ${SCHEMA}.portal_domains (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant uuid NOT NULL,
    domain text NOT NULL,
    status ${SCHEMA}.portal_domain_status NOT NULL DEFAULT 'pending_dns',
    status_message text,
    last_checked_at timestamptz DEFAULT now(),
    verification_details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (tenant, id)
  )`);

  const citus = await db.raw(`SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus`);
  if (citus.rows[0]?.has_citus) {
    try {
      await db.raw(`SELECT create_distributed_table('${SCHEMA}.portal_domains', 'tenant')`);
      distributed = true;
    } catch (error) {
      // A Citus coordinator with no worker nodes cannot distribute; fall back to a local table.
      console.warn('[portal-domains-migration-test] could not distribute portal_domains:', (error as Error).message);
    }
  }

  for (const seed of seeds) {
    await db('portal_domains').insert({
      tenant: seed.tenant,
      domain: seed.domain,
      status: seed.status,
      status_message: seed.message ?? null,
      verification_details: JSON.stringify(seed.details),
      last_checked_at: STALE,
      updated_at: STALE,
    });
  }
}, 120_000);

afterAll(async () => {
  if (db) {
    await db.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
    await db.destroy().catch(() => undefined);
  }
});

describe('activate pending_redirect_uri portal domains migration (DB-backed)', () => {
  it('moves hosted and appliance pending_redirect_uri rows to active with the standard live message', async () => {
    await migration.up(db);

    const hosted = await rowFor('hostedPending');
    expect(hosted.status).toBe('active');
    expect(hosted.status_message).toBe(HOSTED_LIVE_MESSAGE);
    expect(hosted.verification_details).toEqual({ expected_cname: 'x.portal.test' });
    expect(new Date(hosted.updated_at).getTime()).toBeGreaterThan(STALE.getTime());
    expect(new Date(hosted.last_checked_at).getTime()).toBeGreaterThan(STALE.getTime());

    const appliance = await rowFor('applianceWithGate');
    expect(appliance.status).toBe('active');
    expect(appliance.status_message).toBe(
      'Active. Ensure msp.appliance.test resolves to this server and that your reverse proxy terminates TLS and forwards the original Host header to it.'
    );
    expect(appliance.verification_details).toEqual({ proxy_target_host: 'app.local' });
  });

  it('leaves rows in other statuses untouched', async () => {
    for (const key of ['activeWithLegacyDetails', 'dnsPending', 'dnsFailed']) {
      const seed = seeds.find((s) => s.key === key)!;
      const row = await rowFor(key);
      expect(row.status).toBe(seed.status);
      expect(row.status_message).toBe(seed.message);
      expect(row.verification_details).toEqual(seed.details);
      expect(new Date(row.updated_at).getTime()).toBe(STALE.getTime());
    }
  });

  it('leaves no row in pending_redirect_uri, and is idempotent', async () => {
    await migration.up(db);
    const remaining = await db('portal_domains').whereRaw(`status::text = 'pending_redirect_uri'`);
    expect(remaining).toHaveLength(0);
    // Set when the run targets Citus, so a silent fallback to a local table cannot pass as a Citus run.
    if (process.env.PORTAL_DOMAINS_MIGRATION_REQUIRE_CITUS === 'true') {
      expect(distributed).toBe(true);
    }
  });
});
