/**
 * Error Handler Middleware
 * Provides consistent error handling and logging for API routes
 */

import { NextApiRequest, NextApiResponse } from 'next';

export function withErrorHandler(handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      return await handler(req, res);
    } catch (error: any) {
      console.error('API Error:', {
        method: req.method,
        url: req.url,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });

      // Handle specific error types
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          error: 'Validation failed',
          message: error.message,
          details: error.details || []
        });
      }

      if (error.name === 'NotFoundError') {
        return res.status(404).json({
          error: 'Resource not found',
          message: error.message
        });
      }

      if (error.name === 'UnauthorizedError') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: error.message
        });
      }

      if (error.name === 'ForbiddenError') {
        return res.status(403).json({
          error: 'Forbidden',
          message: error.message
        });
      }

      // Handle database errors
      if (error.code === '23505') { // PostgreSQL unique violation
        return res.status(409).json({
          error: 'Conflict',
          message: 'Resource already exists'
        });
      }

      // Default server error
      return res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
      });
    }
  };
}