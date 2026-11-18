import type { Knex } from 'knex';
import { resolveEffectiveTimeZone } from '@alga-psa/db';
import { toCalendarDateStringInTimeZone } from '@alga-psa/core';

/**
 * The caller's local calendar date `YYYY-MM-DD` for the "overdue" tab (design: `follow_up_on < today` in
 * the user's time zone). Time zone: user, then tenant settings, then UTC. `now` is injectable for tests.
 */
export async function resolveCustodyToday(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
  now: Date = new Date()
): Promise<string> {
  const timeZone = await resolveEffectiveTimeZone(knex, tenant, userId);
  return toCalendarDateStringInTimeZone(now, timeZone);
}
