/**
 * T002 — marketing module isolation guard.
 *
 * Two independent checks keep the marketing module drop-safe:
 *
 * 1. FK direction (DB): schema inspection proves no core table (clients,
 *    contacts, interactions, opportunities, users, tenants) has a foreign key
 *    referencing any marketing table, while marketing tables DO reference
 *    core. If a future migration adds a core -> marketing edge, the module is
 *    no longer droppable and this test fails.
 *
 * 2. tenantDb metadata coverage (no DB): all 13 marketing tables must be
 *    registered in the tenantDb metadata with scope 'tenant', or the
 *    app-layer tenant isolation facade would refuse/mis-scope queries.
 *
 * The FK-direction half requires the standard test DB; it is skipped
 * automatically when no database is reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { tenantTableMetadata } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

const describeDb = await describeWithDb();

const MARKETING_TABLES = [
  'marketing_campaigns',
  'marketing_content',
  'marketing_channels',
  'marketing_capture_forms',
  'social_posts',
  'social_post_targets',
  'marketing_sequences',
  'marketing_sequence_steps',
  'marketing_sequence_enrollments',
  'marketing_sequence_sends',
  'marketing_contact_state',
  'marketing_suppressions',
  'marketing_engagements',
] as const;

const CORE_TABLES = [
  'clients',
  'contacts',
  'interactions',
  'opportunities',
  'users',
  'tenants',
] as const;

describe('T002: tenantDb metadata coverage (no DB required)', () => {
  it('registers all 13 marketing tables with tenant scope', () => {
    for (const table of MARKETING_TABLES) {
      expect(
        tenantTableMetadata[table],
        `${table} must be registered in tenantTableMetadata`,
      ).toEqual({ scope: 'tenant' });
    }
  });
});

describeDb('T002: FK direction guard', () => {
  let db: Knex;
  let edges: Array<{ src_table: string; dst_table: string }>;

  // Read the FK edges straight from pg_catalog (pg_constraint) rather than the
  // information_schema views. The equivalent information_schema query joins
  // constraint_column_usage, which is a very expensive view on a schema this
  // size (~8s per call); under parallel CI load two such calls blew past the
  // 20s test timeout. The catalog query is the same edge set in milliseconds,
  // and computing it once in beforeAll keeps both assertions cheap.
  async function foreignKeyEdges(): Promise<Array<{ src_table: string; dst_table: string }>> {
    const result = await db.raw(
      `SELECT DISTINCT src.relname AS src_table, dst.relname AS dst_table
       FROM pg_constraint c
       JOIN pg_class src ON src.oid = c.conrelid
       JOIN pg_class dst ON dst.oid = c.confrelid
       JOIN pg_namespace n ON n.oid = src.relnamespace
       WHERE c.contype = 'f'
         AND n.nspname = 'public'`,
    );
    return result.rows as Array<{ src_table: string; dst_table: string }>;
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    edges = await foreignKeyEdges();
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('has no foreign key from any core table into a marketing table', async () => {
    const coreToMarketing = edges.filter(
      (edge) =>
        (CORE_TABLES as readonly string[]).includes(edge.src_table) &&
        (MARKETING_TABLES as readonly string[]).includes(edge.dst_table),
    );
    expect(coreToMarketing).toEqual([]);
  });

  it('has foreign keys from marketing tables into core tables', async () => {
    const marketingToCore = edges.filter(
      (edge) =>
        (MARKETING_TABLES as readonly string[]).includes(edge.src_table) &&
        (CORE_TABLES as readonly string[]).includes(edge.dst_table),
    );

    const referencedCoreTables = new Set(marketingToCore.map((edge) => edge.dst_table));
    // Spot-check the load-bearing edges: enrollments/contact-state hang off
    // contacts, engagements hang off interactions, everything hangs off
    // tenants, and created_by/published_by hang off users.
    expect(referencedCoreTables).toContain('contacts');
    expect(referencedCoreTables).toContain('interactions');
    expect(referencedCoreTables).toContain('users');
    expect(referencedCoreTables).toContain('tenants');
  });
});
