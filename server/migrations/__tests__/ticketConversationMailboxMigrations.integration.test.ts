import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const grants = require('../20260908033011_create_ticket_conversation_sender_grants.cjs');
const email = require('../20260908034701_create_ticket_conversation_email_operations.cjs');
const GRANTS = 'ticket_conversation_sender_grants';
const ROUTES = 'ticket_conversation_email_routes';
const citus = process.env.TEST_DB_BACKEND === 'citus';
let bootstrap: Knex;
let migrationsDir: string;

beforeAll(async () => {
  wireLocalTestDbEnv();
  migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-mailbox-migrations-'));
  bootstrap = await createTestDbConnection({
    databaseName: 'test_conversation_mailbox_migrations', migrationsDir, runSeeds: false,
  });
}, 60_000);

afterAll(async () => {
  await bootstrap?.destroy();
  if (migrationsDir) fs.rmSync(migrationsDir, { recursive: true, force: true });
});

describe('conversation mailbox migrations', () => {
  it.each(citus ? ['local', 'distributed', 'citus-local'] : ['local'])(
    'retains mailbox data and installs usable grants and routes with %s providers', async (providerKind) => {
      const schema = `mailbox_${randomUUID().replaceAll('-', '')}`;
      await bootstrap.raw('CREATE SCHEMA ??', [schema]);
      const db = knex({ client: 'pg', connection: bootstrap.client.config.connection,
        searchPath: [schema, 'public'], pool: { min: 0, max: 1 } });
      const tenant = randomUUID(), otherTenant = randomUUID(), mailbox = randomUUID();
      try {
        await db.schema.createTable('tenants', t => { t.uuid('tenant').primary(); });
        await db.schema.createTable('email_providers', t => {
          t.uuid('tenant').notNullable(); t.uuid('id').notNullable(); t.text('mailbox').notNullable();
          t.primary(['tenant', 'id']);
        });
        for (const table of ['ticket_conversation_editor_drafts', 'ticket_conversation_publications']) {
          await db.schema.createTable(table, t => { t.uuid('tenant').notNullable(); });
        }
        if (citus) {
          await db.raw("SELECT create_distributed_table('tenants', 'tenant')");
          if (providerKind === 'distributed') {
            await db.raw("SELECT create_distributed_table('email_providers', 'tenant', colocate_with => 'tenants')");
          } else if (providerKind === 'citus-local') {
            await db.raw("SELECT citus_add_local_table_to_metadata('email_providers')");
          }
        }
        await db('email_providers').insert([
          { tenant, id: mailbox, mailbox: 'owner@example.com' },
          { tenant: otherTenant, id: mailbox, mailbox: 'other@example.com' },
        ]);
        const providersBefore = await db('email_providers').orderBy('tenant');
        await grants.up(db);
        await email.up(db);
        const grant = { tenant, mailbox_id: mailbox, conversation_store_tenant: tenant,
          conversation_id: randomUUID(), ticket_tenant: tenant, ticket_id: randomUUID(),
          relationship_id: randomUUID(), grantee_tenant: otherTenant, grantee_user_id: randomUUID(),
          granted_by_user_id: randomUUID() };
        const route = { tenant, mailbox_id: mailbox, token_hash: 'a'.repeat(64),
          operation_tenant: tenant, operation_id: randomUUID(), ticket_tenant: tenant,
          ticket_id: grant.ticket_id, conversation_store_tenant: tenant,
          conversation_id: grant.conversation_id, rfc_message_id: '<retained@example.com>' };
        await db(GRANTS).insert(grant);
        await db(ROUTES).insert(route);
        if (citus && providerKind === 'local') {
          // Reproduce the state left by the original nontransactional migrations:
          // the table and FK exist, but distribution failed. Retain rows on retry.
          for (const table of [GRANTS, ROUTES]) {
            await db.raw('SELECT undistribute_table(?::regclass)', [table]);
            await db.schema.alterTable(table, t => {
              t.foreign(['tenant', 'mailbox_id']).references(['tenant', 'id']).inTable('email_providers');
            });
          }
        }
        // Both migrations are retryable after retained records exist.
        await grants.up(db);
        await email.up(db);
        expect(await db(GRANTS).where({ tenant, mailbox_id: mailbox }).first()).toMatchObject(grant);
        expect(await db(ROUTES).where({ tenant, mailbox_id: mailbox }).first()).toMatchObject(route);
        expect(await db('email_providers').orderBy('tenant')).toEqual(providersBefore);
        if (citus) {
          const distribution = await db.raw(`SELECT logicalrelid::regclass::text AS name, partmethod, colocationid
            FROM pg_dist_partition WHERE logicalrelid IN (?::regclass, ?::regclass, 'tenants'::regclass)`, [GRANTS, ROUTES]);
          expect(distribution.rows).toHaveLength(3);
          expect(distribution.rows.every((r: any) => r.partmethod === 'h')).toBe(true);
          expect(new Set(distribution.rows.map((r: any) => r.colocationid)).size).toBe(1);
        }
        if (!citus || providerKind === 'distributed') {
          // A mailbox belonging only to another tenant cannot satisfy either FK.
          const foreignMailbox = randomUUID();
          await db('email_providers').insert({ tenant: otherTenant, id: foreignMailbox, mailbox: 'foreign@example.com' });
          await expect(db(GRANTS).insert({ ...grant, mailbox_id: foreignMailbox })).rejects.toMatchObject({ code: '23503' });
          await expect(db(ROUTES).insert({ ...route, mailbox_id: foreignMailbox })).rejects.toMatchObject({ code: '23503' });
        }
      } finally {
        await db.destroy();
        await bootstrap.raw('DROP SCHEMA ?? CASCADE', [schema]);
      }
    }, 60_000,
  );
});
