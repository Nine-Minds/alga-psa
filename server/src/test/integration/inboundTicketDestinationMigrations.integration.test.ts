import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

describe('inbound ticket destination migrations (integration)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('T001: migration adds clients.inbound_ticket_defaults_id as nullable UUID', async () => {
    await expect(knex.schema.hasColumn('clients', 'inbound_ticket_defaults_id')).resolves.toBe(true);

    const column = await knex('information_schema.columns')
      .where({
        table_schema: 'public',
        table_name: 'clients',
        column_name: 'inbound_ticket_defaults_id',
      })
      .select<{ is_nullable: string; data_type: string }[]>('is_nullable', 'data_type')
      .first();

    expect(column).toBeTruthy();
    expect(column?.is_nullable).toBe('YES');
    expect(column?.data_type).toBe('uuid');
  });
});
