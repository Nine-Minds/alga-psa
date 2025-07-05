import { Worker, NativeConnection } from '@temporalio/worker';
import { createLogger, format, transports } from 'winston';
import * as activities from './activities/index.js';
import * as dotenv from 'dotenv';
import express from 'express';

// Load environment variables
dotenv.config();

// Configure logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    })
  ]
});

/**
 * Configuration for the Temporal worker
 */
interface WorkerConfig {
  temporalAddress: string;
  temporalNamespace: string;
  taskQueue: string;
  maxConcurrentActivityTaskExecutions: number;
  maxConcurrentWorkflowTaskExecutions: number;
}

/**
 * Get worker configuration from environment variables
 */
function getWorkerConfig(): WorkerConfig {
  return {
    temporalAddress: process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233',
    temporalNamespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'tenant-workflows',
    maxConcurrentActivityTaskExecutions: parseInt(process.env.MAX_CONCURRENT_ACTIVITIES || '10'),
    maxConcurrentWorkflowTaskExecutions: parseInt(process.env.MAX_CONCURRENT_WORKFLOWS || '10'),
  };
}

/**
 * Create and configure the Temporal worker
 */
async function createWorker(config: WorkerConfig): Promise<Worker> {
  logger.info('Connecting to Temporal', { 
    address: config.temporalAddress,
    namespace: config.temporalNamespace 
  });

  // Connect to Temporal
  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  logger.info('Connected to Temporal successfully');

  // Create worker
  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    workflowsPath: new URL('./workflows/index.js', import.meta.url).pathname,
    activities,
    taskQueue: config.taskQueue,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivityTaskExecutions,
    maxConcurrentWorkflowTaskExecutions: config.maxConcurrentWorkflowTaskExecutions,
    // Enable detailed logging in development
    debugMode: process.env.NODE_ENV === 'development',
  });

  logger.info('Worker created successfully', {
    taskQueue: config.taskQueue,
    maxConcurrentActivities: config.maxConcurrentActivityTaskExecutions,
    maxConcurrentWorkflows: config.maxConcurrentWorkflowTaskExecutions,
  });

  return worker;
}

/**
 * Handle graceful shutdown
 */
function setupGracefulShutdown(worker: Worker): void {
  const shutdownHandler = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    try {
      await worker.shutdown();
      logger.info('Worker shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during worker shutdown', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  
  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise });
    process.exit(1);
  });
}

/**
 * Health check endpoint for Kubernetes
 */
function startHealthCheck(): void {
  if (process.env.ENABLE_HEALTH_CHECK === 'true') {
    const app = express();
    const port = process.env.HEALTH_CHECK_PORT || 8080;

    app.get('/health', (req: any, res: any) => {
      res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        worker: 'running'
      });
    });

    app.get('/ready', (req: any, res: any) => {
      res.status(200).json({ 
        status: 'ready', 
        timestamp: new Date().toISOString(),
        worker: 'ready'
      });
    });

    app.listen(port, () => {
      logger.info(`Health check server listening on port ${port}`);
    });
  }
}

/**
 * Main function to start the worker
 */
async function main(): Promise<void> {
  try {
    logger.info('Starting Temporal worker for tenant workflows');

    // Get configuration
    const config = getWorkerConfig();
    logger.info('Worker configuration', config);

    // Validate required environment variables
    if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
      throw new Error('Database configuration missing. Set DATABASE_URL or DB_* environment variables.');
    }

    // Create and start worker
    const worker = await createWorker(config);
    
    // Setup graceful shutdown
    setupGracefulShutdown(worker);
    
    // Start health check server if enabled
    startHealthCheck();

    logger.info('Worker starting...', { taskQueue: config.taskQueue });
    
    // Start the worker (this will run indefinitely)
    await worker.run();
    
  } catch (error) {
    logger.error('Failed to start worker', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Start the worker if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Worker failed to start:', error);
    process.exit(1);
  });
}

export { main as startWorker };