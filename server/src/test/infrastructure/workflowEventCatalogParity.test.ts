import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { WORKFLOW_EVENT_CATALOG } from '@alga-psa/event-schemas';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

/**
 * Parity between the code-level workflow event catalog and the migrated
 * `system_event_catalog` table (integration lane; needs the migrated test DB).
 *
 * Migrations remain the writer because tenant databases are seeded by them; the
 * code map is the reviewed contract. A row the map does not list, a map entry
 * with no row, or a ref mismatch on either side fails here.
 */
describe('workflow event catalog parity (system_event_catalog)', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('system_event_catalog rows with a payload_schema_ref equal WORKFLOW_EVENT_CATALOG exactly', async () => {
    const rows: Array<{ event_type: string; payload_schema_ref: string }> = await db('system_event_catalog')
      .whereNotNull('payload_schema_ref')
      .select('event_type', 'payload_schema_ref');

    const actual = Object.fromEntries(rows.map((row) => [row.event_type, row.payload_schema_ref]));
    const expected = Object.fromEntries(
      Object.entries(WORKFLOW_EVENT_CATALOG).map(([eventType, { schemaRef }]) => [eventType, schemaRef])
    );

    const missingFromDb = Object.keys(expected).filter((eventType) => !(eventType in actual));
    const missingFromCode = Object.keys(actual).filter((eventType) => !(eventType in expected));
    const refMismatches = Object.keys(expected)
      .filter((eventType) => eventType in actual && actual[eventType] !== expected[eventType])
      .map((eventType) => ({ eventType, code: expected[eventType], db: actual[eventType] }));

    expect({ missingFromDb, missingFromCode, refMismatches }).toEqual({
      missingFromDb: [],
      missingFromCode: [],
      refMismatches: [],
    });
  });
});
