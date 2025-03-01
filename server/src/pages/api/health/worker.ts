import { NextApiRequest, NextApiResponse } from 'next';
import { getWorkerService } from '../../../lib/workflow/workers/workerService';

/**
 * Health check endpoint for the workflow worker service
 * 
 * This endpoint returns the health status of the workflow worker service.
 * It can be used by monitoring systems to check if the worker service is running properly.
 * 
 * GET /api/health/worker
 * 
 * Response:
 * - 200 OK: Worker service is healthy
 * - 503 Service Unavailable: Worker service is degraded or unhealthy
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the worker service instance
    const workerService = getWorkerService();
    
    // Get the health status
    const health = workerService.getHealth();
    
    // Get statistics
    const stats = workerService.getStatistics();
    
    // Combine health and stats
    const response = {
      status: health.status,
      workerCount: health.workerCount,
      healthyWorkers: health.healthyWorkers,
      degradedWorkers: health.degradedWorkers,
      unhealthyWorkers: health.unhealthyWorkers,
      eventsProcessed: stats.totalEventsProcessed,
      eventsSucceeded: stats.totalEventsSucceeded,
      eventsFailed: stats.totalEventsFailed,
      activeEvents: stats.activeEventCount,
      timestamp: new Date().toISOString()
    };
    
    // Return appropriate status code based on health status
    if (health.status === 'healthy') {
      return res.status(200).json(response);
    } else {
      return res.status(503).json(response);
    }
  } catch (error) {
    console.error('[WorkerHealthCheck] Error checking worker health:', error);
    
    return res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
}