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
  // Use specific queue if defined, or default
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'tenant-workflows';

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
        logger.info(`Schedule ${scheduleId} already exists. Skipping creation.`);
      } else {
        logger.warn(`Failed to create schedule ${scheduleId}: ${error.message}. This is expected if schedule already exists.`);
      }
    }

  } catch (error) {
    logger.error('Failed to connect to Temporal for schedule setup', error);
  }
}
