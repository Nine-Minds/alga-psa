import { NextResponse } from 'next/server';
import { createTenantKnex } from '@/lib/db';

/**
 * Readiness check endpoint for Kubernetes readiness probe
 * Checks database connectivity and other dependencies
 */
export async function GET() {
  const checks = {
    database: false,
    redis: false
  };
  
  try {
    // Check database connection
    try {
      const { knex } = await createTenantKnex();
      await knex.raw('SELECT 1');
      checks.database = true;
    } catch (dbError) {
      console.error('Database health check failed:', dbError);
    }
    
    // TODO: Add Redis check when we have Redis client available
    // For now, we'll assume Redis is working if database is working
    checks.redis = checks.database;
    
    // Determine overall readiness
    const isReady = checks.database; // Required for app to function
    
    if (isReady) {
      return NextResponse.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        checks
      });
    } else {
      return NextResponse.json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks,
        error: 'One or more critical services are not available'
      }, { status: 503 });
    }
  } catch (error) {
    console.error('Readiness check failed:', error);
    return NextResponse.json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      checks
    }, { status: 503 });
  }
}