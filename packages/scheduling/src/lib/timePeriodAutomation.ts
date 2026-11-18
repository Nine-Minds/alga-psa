/**
 * Nightly time period creation for one tenant.
 *
 * Deliberately NOT in a 'use server' module. The caller names a tenant and a Knex handle (a job,
 * never a browser) and the settings are loaded here from that tenant's own active rows, so no
 * caller can drive period creation from settings it supplies.
 */
import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import type { ITimePeriod } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { withTransaction } from '@alga-psa/db';
import { TimePeriodSettings } from '../models/timePeriodSettings';
import { createTimePeriodsThrough } from './timePeriodMaterialization';

export type CreateNextTimePeriodResult =
  | { settingsConfigured: false; period: null }
  | { settingsConfigured: true; period: ITimePeriod | null };

/**
 * Creates the next time period(s) from the tenant's active settings, filling any gap up to
 * `daysThreshold` days ahead. Runs in its own transaction (all-or-nothing) under the per-tenant
 * time-period advisory lock taken by createTimePeriodsThrough.
 *
 * @param daysThreshold - How many days ahead to create periods (default 5)
 * @param options.today - The date to treat as today (default: today in UTC; there is no user session)
 */
export async function createNextTimePeriod(
  db: Knex,
  tenant: string,
  daysThreshold: number = 5,
  options: { today?: Temporal.PlainDate } = {}
): Promise<CreateNextTimePeriodResult> {
  if (!tenant) {
    throw new Error('Tenant is required to create the next time period.');
  }

  const settings = await TimePeriodSettings.getActiveSettings(db, tenant);
  if (settings.length === 0) {
    return { settingsConfigured: false, period: null };
  }

  try {
    const today = options.today ?? Temporal.Now.plainDateISO('UTC');
    const period = await withTransaction(db, (trx) =>
      createTimePeriodsThrough(trx, tenant, settings, today, daysThreshold)
    );
    return { settingsConfigured: true, period };
  } catch (error) {
    logger.error('Error creating next time period:', error);
    throw error;
  }
}
