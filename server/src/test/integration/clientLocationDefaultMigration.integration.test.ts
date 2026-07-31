import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260718234058_enforce_single_default_client_location.cjs') as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
  down: (knex: Knex | Knex.Transaction) => Promise<void>;
};

describe('single default client location migration (integration)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection({ runSeeds: true });
  });

  afterAll(async () => {
    await knex?.destroy();
  });

  it('normalizes defaults, backfills missing defaults, and enforces uniqueness', async () => {
    const trx = await knex.transaction();
    let testError: unknown;

    try {
      await migration.down(trx);
      const tenantRow = await trx('tenants').select('tenant').first();
      if (!tenantRow?.tenant) {
        throw new Error('Expected the integration database to contain a seeded tenant');
      }

      const clientIds = {
        duplicate: uuidv4(),
        inactive: uuidv4(),
        missing: uuidv4(),
        healthy: uuidv4(),
      };
      await trx('clients').insert(Object.entries(clientIds).map(([label, clientId]) => ({
        tenant: tenantRow.tenant,
        client_id: clientId,
        client_name: `Default migration ${label} ${clientId}`,
      })));

      const duplicateOlder = uuidv4();
      const duplicateWinner = uuidv4();
      const inactiveDefault = uuidv4();
      const activeDefault = uuidv4();
      const missingWinner = uuidv4();
      const missingLater = uuidv4();
      const healthyDefault = uuidv4();
      const baseLocation = {
        tenant: tenantRow.tenant,
        location_name: 'Migration fixture',
        address_line1: '1 Test Way',
        city: 'Testville',
        country_code: 'US',
        country_name: 'United States',
      };

      await trx('client_locations').insert([
        { ...baseLocation, location_id: duplicateOlder, client_id: clientIds.duplicate, is_active: true, is_default: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { ...baseLocation, location_id: duplicateWinner, client_id: clientIds.duplicate, is_active: true, is_default: true, created_at: '2026-01-02T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' },
        { ...baseLocation, location_id: inactiveDefault, client_id: clientIds.inactive, is_active: false, is_default: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { ...baseLocation, location_id: activeDefault, client_id: clientIds.inactive, is_active: true, is_default: true, created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
        { ...baseLocation, location_id: missingWinner, client_id: clientIds.missing, is_active: true, is_default: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { ...baseLocation, location_id: missingLater, client_id: clientIds.missing, is_active: true, is_default: false, created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
        { ...baseLocation, location_id: healthyDefault, client_id: clientIds.healthy, is_active: true, is_default: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ]);

      await migration.up(trx);

      const rows = await trx('client_locations')
        .where({ tenant: tenantRow.tenant })
        .whereIn('client_id', Object.values(clientIds))
        .select('location_id', 'is_default');
      const defaultByLocation = new Map(rows.map((row) => [row.location_id, row.is_default]));

      expect(defaultByLocation.get(duplicateOlder)).toBe(false);
      expect(defaultByLocation.get(duplicateWinner)).toBe(true);
      expect(defaultByLocation.get(inactiveDefault)).toBe(false);
      expect(defaultByLocation.get(activeDefault)).toBe(true);
      expect(defaultByLocation.get(missingWinner)).toBe(true);
      expect(defaultByLocation.get(missingLater)).toBe(false);
      expect(defaultByLocation.get(healthyDefault)).toBe(true);

      const index = await trx('pg_indexes')
        .where({ schemaname: 'public', tablename: 'client_locations', indexname: 'ux_client_locations_default_per_client' })
        .select('indexdef')
        .first();
      expect(index?.indexdef).toContain('UNIQUE INDEX');
      expect(index?.indexdef).toContain('WHERE (is_default = true)');

      let duplicateError: unknown;
      try {
        await trx.transaction(async (savepoint) => {
          await savepoint('client_locations').insert({
            ...baseLocation,
            location_id: uuidv4(),
            client_id: clientIds.healthy,
            is_active: true,
            is_default: true,
          });
        });
      } catch (error) {
        duplicateError = error;
      }
      expect(duplicateError).toMatchObject({ code: '23505' });
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }

    if (testError) {
      throw testError;
    }
  });
});
