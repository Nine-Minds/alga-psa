import express from 'express';
import type { Request, Response } from 'express';
import { WorkflowWorker } from './WorkflowWorker.js';
import logger from '@alga-psa/core/logger';

export class WorkerServer {
  private app = express();
  private port = process.env.PORT || 4000;
  private worker: WorkflowWorker;

  constructor(worker: WorkflowWorker) {
    this.worker = worker;
    this.setupRoutes();
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      try {
        const health = this.worker.getHealth();
        
        // Return appropriate status code based on health status
        if (health.status === 'healthy') {
          res.status(200).json(health);
        } else if (health.status === 'degraded') {
          res.status(200).json(health); // Still 200 but with degraded status
        } else {
          res.status(503).json(health); // Service Unavailable
        }
      } catch (error) {
        logger.error('[WorkerServer] Error in health check endpoint:', error);
        res.status(500).json({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', (req: Request, res: Response) => {
      try {
        const health = this.worker.getHealth();
        res.status(200).json({
          eventsProcessed: health.eventsProcessed,
          eventsSucceeded: health.eventsSucceeded,
          eventsFailed: health.eventsFailed,
          activeEventCount: health.activeEventCount,
          uptime: health.uptime,
          memoryUsage: health.memoryUsage
        });
      } catch (error) {
        logger.error('[WorkerServer] Error in metrics endpoint:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        logger.info(`[WorkerServer] HTTP server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Nothing to clean up for now
    // In the future, we might need to close the HTTP server properly
  }
}
