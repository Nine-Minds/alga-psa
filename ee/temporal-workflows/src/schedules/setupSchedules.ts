import { Client, Connection, ScheduleOverlapPolicy } from '@temporalio/client';
import { createLogger, format, transports } from 'winston';
import { emailWebhookMaintenanceWorkflow } from '../workflows';
import * as dotenv from 'dotenv';

dotenv.config();

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    })
  ]
});

export async function setupSchedules() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';
  const temporalNamespace = process.env.TEMPORAL_NAMESPACE || 'default';
  // Use specific queue for email maintenance
  const taskQueue = 'email-domain-workflows';

  logger.info('Initializing Temporal Schedules...', { temporalAddress, temporalNamespace });

  try {
    const connection = await Connection.connect({ address: temporalAddress });
    const client = new Client({ connection, namespace: temporalNamespace });

    const scheduleId = 'email-webhook-maintenance-schedule';

    // Create the Schedule
    try {
      await client.schedule.create({
        scheduleId,
        spec: {
          intervals: [{ every: '15m' }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: emailWebhookMaintenanceWorkflow,
          args: [{ lookAheadMinutes: 1440 }], // Check 24h ahead every 15m to catch anything expiring soon
          taskQueue,
          workflowExecutionTimeout: '10m',
        },
        policies: {
          overlap: ScheduleOverlapPolicy.SKIP, // Don't stack runs
          catchupWindow: '1m', // Don't run old missed schedules
        },
      });
      logger.info(`Successfully created schedule: ${scheduleId}`);
    } catch (error: any) {
      if (error?.code === 6 || error?.name === 'ScheduleAlreadyRunning' || error?.message?.includes('AlreadyExists')) {
        logger.info(`Schedule ${scheduleId} already exists. Updating configuration...`);
        try {
          const handle = client.schedule.getHandle(scheduleId);
          await handle.update((prev) => ({
            ...prev,
            spec: {
              intervals: [{ every: '15m' }],
            },
            action: {
              type: 'startWorkflow',
              workflowType: emailWebhookMaintenanceWorkflow,
              args: [{ lookAheadMinutes: 1440 }],
              taskQueue: 'email-domain-workflows',
              workflowExecutionTimeout: '10m',
            },
          }));
          logger.info(`Successfully updated schedule: ${scheduleId}`);
        } catch (updateError: any) {
          logger.error(`Failed to update existing schedule ${scheduleId}`, updateError);
        }
      } else {
        logger.warn(`Failed to create schedule ${scheduleId}: ${error.message}.`);
      }
    }

  } catch (error) {
    logger.error('Failed to connect to Temporal for schedule setup', error);
  }
}
