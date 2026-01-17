/**
 * Guard Schedule Process Cron Handler
 *
 * Runs every minute to check for scheduled scans that need to be executed.
 */

import logger from '@shared/core/logger';
import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { scheduleImmediateJob } from '../index';
import type { IGuardSchedule } from '../../../interfaces/guard/schedule.interfaces';
import { calculateNextRunAt } from '../../actions/guard-actions/scheduleUtils';

/**
 * Handler for guard:schedules:process cron job
 *
 * This cron job runs every minute and:
 * 1. Queries for schedules where next_run_at <= now
 * 2. Creates scan jobs for each due schedule
 * 3. Updates next_run_at for the schedule
 */
export async function guardScheduleProcessHandler(): Promise<void> {
  logger.debug('Processing guard schedules');

  const { knex: db, tenant } = await createTenantKnex();

  if (!tenant) {
    logger.warn('No tenant context for schedule processing');
    return;
  }

  try {
    const now = new Date();

    // Find all due schedules
    const dueSchedules = await db('guard_schedules')
      .where({ tenant, enabled: true })
      .where('next_run_at', '<=', now)
      .select('*');

    if (dueSchedules.length === 0) {
      logger.debug('No schedules due for execution');
      return;
    }

    logger.info('Processing due schedules', {
      tenant,
      count: dueSchedules.length,
    });

    // Process each due schedule
    for (const schedule of dueSchedules as IGuardSchedule[]) {
      try {
        await processSchedule(db, tenant, schedule);
      } catch (error) {
        logger.error('Failed to process schedule', {
          tenant,
          scheduleId: schedule.id,
          error,
        });
        // Continue processing other schedules
      }
    }

    logger.info('Schedule processing completed', {
      tenant,
      processed: dueSchedules.length,
    });

  } catch (error) {
    logger.error('Schedule processing failed', { tenant, error });
    throw error;
  }
}

/**
 * Process a single schedule
 */
async function processSchedule(
  db: any,
  tenant: string,
  schedule: IGuardSchedule
): Promise<void> {
  logger.info('Processing schedule', {
    tenant,
    scheduleId: schedule.id,
    scheduleType: schedule.schedule_type,
    targetId: schedule.target_id,
  });

  await withTransaction(db, async (trx) => {
    // Create the appropriate scan job based on schedule type
    if (schedule.schedule_type === 'pii_scan') {
      // Create PII scan job
      const [job] = await trx('guard_pii_jobs')
        .insert({
          tenant,
          profile_id: schedule.target_id,
          status: 'queued',
          total_files_scanned: 0,
          total_matches: 0,
          progress_percent: 0,
          metadata: JSON.stringify({ triggered_by_schedule: schedule.id }),
        })
        .returning('*');

      // Queue the scan job
      await scheduleImmediateJob('guard:pii:scan', {
        tenantId: tenant,
        jobId: job.id,
        profileId: schedule.target_id,
      });

      logger.info('Queued PII scan from schedule', {
        tenant,
        scheduleId: schedule.id,
        jobId: job.id,
      });

    } else if (schedule.schedule_type === 'asm_scan') {
      // Create ASM scan job
      const [job] = await trx('guard_asm_jobs')
        .insert({
          tenant,
          domain_id: schedule.target_id,
          status: 'queued',
          total_findings: 0,
          progress_percent: 0,
          metadata: JSON.stringify({ triggered_by_schedule: schedule.id }),
        })
        .returning('*');

      // Queue the scan job
      await scheduleImmediateJob('guard:asm:scan', {
        tenantId: tenant,
        jobId: job.id,
        domainId: schedule.target_id,
      });

      logger.info('Queued ASM scan from schedule', {
        tenant,
        scheduleId: schedule.id,
        jobId: job.id,
      });
    }

    // Calculate and update next run time
    const nextRunAt = calculateNextRunAt(
      schedule.frequency,
      schedule.time_of_day,
      schedule.timezone,
      schedule.day_of_week,
      schedule.day_of_month
    );

    await trx('guard_schedules')
      .where({ tenant, id: schedule.id })
      .update({
        last_run_at: new Date(),
        next_run_at: nextRunAt,
        updated_at: new Date(),
      });

    logger.info('Updated schedule next run', {
      tenant,
      scheduleId: schedule.id,
      nextRunAt,
    });
  });
}
