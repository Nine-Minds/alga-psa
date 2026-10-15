import type { Knex } from 'knex';
import { createRecurringBillingFixture } from './recurring-billing';

/** Preserve the overlapping bucket and usage preconditions for this journey. */
export async function createUsageFixture(db: Knex, sourceEmail: string) {
  const fixture = await createRecurringBillingFixture(db, sourceEmail, 'usage');
  if (!fixture.bucketLine) throw new Error('Usage fixture requires an overlapping bucket');
  return { ...fixture, usageLine: fixture.line, bucketLine: fixture.bucketLine };
}
