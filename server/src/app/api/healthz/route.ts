import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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
    environment: process.env.NODE_ENV || 'development',
    // Set by the supervised review-app launcher. This is returned by the
    // running server process so deployment checks can distinguish a live
    // replacement from an old listener or stale build.
    reviewBuildIdentity: process.env.ALGA_REVIEW_BUILD_ID || null
  });
}
