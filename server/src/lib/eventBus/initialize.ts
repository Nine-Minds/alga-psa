import { initializeEmailNotificationConsumer } from './consumers/emailNotificationConsumer';
import { registerAllSubscribers } from './subscribers';
import logger from '../../utils/logger';
import { getConnection } from '../db/db';

// Store cleanup functions at module scope for access by cleanupEventBus
let cleanupFunctions: Array<() => Promise<void>> = [];

export async function initializeEventBus(): Promise<void> {
  try {
    logger.info('Initializing event bus and subscribers');

    // Register all subscribers
    await registerAllSubscribers();

    // Get all tenants
    const systemDb = await getConnection('system');
    const tenants = await systemDb('tenants')
      .select('tenant');

    // Initialize email notification consumer for each tenant
    cleanupFunctions = await Promise.all(
      tenants.map(async (tenantRecord): Promise<() => Promise<void>> => {
        logger.info(`Initializing email notification consumer for tenant: ${tenantRecord.tenant}`);
        return initializeEmailNotificationConsumer(tenantRecord.tenant);
      })
    );

    // Register SIGTERM handler for graceful shutdown
    process.on('SIGTERM', () => cleanupEventBus());

    logger.info('Event bus initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize event bus:', error);
    throw error;
  }
}

export async function cleanupEventBus(): Promise<void> {
  try {
    logger.info('Shutting down email notification consumers');
    await Promise.all(cleanupFunctions.map((cleanup): Promise<void> => cleanup()));
    cleanupFunctions = []; // Clear the array after cleanup
    logger.info('Event bus cleanup completed successfully');
  } catch (error) {
    logger.error('Failed to cleanup event bus:', error);
    throw error;
  }
}
