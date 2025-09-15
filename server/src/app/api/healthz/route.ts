import { NextResponse } from 'next/server';

/**
 * Health check endpoint for Kubernetes liveness probe
 * Returns basic health status without checking dependencies
 */
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
}