import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import {
  createLocation,
  deleteLocation,
  updateLocation,
} from '../../../../packages/clients/src/models/clientLocation';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

describe('client location default management (integration)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection({ runSeeds: true });
  });

  afterAll(async () => {
    await knex?.destroy();
  });

  it('keeps UI and API location transitions on the same single-default invariant', async () => {
    const trx = await knex.transaction();
    let testError: unknown;

    try {
      const tenantRow = await trx('tenants').select('tenant').first();
      if (!tenantRow?.tenant) {
        throw new Error('Expected the integration database to contain a seeded tenant');
      }

      const clientId = uuidv4();
      await trx('clients').insert({
        tenant: tenantRow.tenant,
        client_id: clientId,
        client_name: `Location model fixture ${clientId}`,
      });

      const locationInput = (name: string) => ({
        location_name: name,
        address_line1: `${name} address`,
        city: 'Testville',
        country_code: 'US',
        country_name: 'United States',
        is_active: true,
      });

      const first = await createLocation(trx, tenantRow.tenant, clientId, locationInput('First'));
      expect(first.is_default).toBe(true);

      const second = await createLocation(trx, tenantRow.tenant, clientId, {
        ...locationInput('Second'),
        is_default: true,
      });
      expect(second.is_default).toBe(true);
      await expect(trx('client_locations').where({ location_id: first.location_id }).first())
        .resolves.toMatchObject({ is_default: false });

      await updateLocation(trx, tenantRow.tenant, clientId, second.location_id, { is_default: false });
      await expect(trx('client_locations').where({ location_id: first.location_id }).first())
        .resolves.toMatchObject({ is_default: true });

      await updateLocation(trx, tenantRow.tenant, clientId, first.location_id, { is_active: false });
      await expect(trx('client_locations').where({ location_id: first.location_id }).first())
        .resolves.toMatchObject({ is_active: false, is_default: false });
      await expect(trx('client_locations').where({ location_id: second.location_id }).first())
        .resolves.toMatchObject({ is_default: true });

      const third = await createLocation(trx, tenantRow.tenant, clientId, locationInput('Third'));
      expect(third.is_default).toBe(false);
      await deleteLocation(trx, tenantRow.tenant, clientId, second.location_id);
      await expect(trx('client_locations').where({ location_id: third.location_id }).first())
        .resolves.toMatchObject({ is_default: true });

      await expect(createLocation(trx, tenantRow.tenant, clientId, {
        ...locationInput('Inactive default'),
        is_active: false,
        is_default: true,
      })).rejects.toThrow('A default location must be active');
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
