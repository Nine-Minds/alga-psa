import { isEnterprise } from './features';
import { parsePolicy } from './auth/ee';
import { initializeEventBus, cleanupEventBus } from './eventBus/initialize';
import logger from '../utils/logger';

export async function initializeApp() {
  try {
    // Initialize event bus
    await initializeEventBus();
    logger.info('Event bus initialized');

    // Register cleanup handlers
    process.on('SIGTERM', async () => {
      await cleanupEventBus();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      await cleanupEventBus();
      process.exit(0);
    });

    // Initialize policy engine
    if (isEnterprise) {
      const { PolicyEngine } = await import('@ee/lib/auth');
      const policyEngine = new PolicyEngine();

      const policies = [
        `ALLOW read ON Ticket`,
        `ALLOW write ON Ticket`,
        // Add more policies as needed
      ];

      for (const policyString of policies) {
        const policy = await parsePolicy(policyString);
        policyEngine.addPolicy(policy);
      }

      logger.info('Policy engine initialized');
      return policyEngine;
    }

    // Community Edition uses basic RBAC only
    return null;
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    throw error;
  }
}
