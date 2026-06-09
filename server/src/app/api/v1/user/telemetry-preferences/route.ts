import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { isUsageStatsEnabled } from 'server/src/config/telemetry';
import logger from 'server/src/utils/logger';

export const dynamic = 'force-dynamic'

// Read-only: usage-stats telemetry is controlled by the ALGA_USAGE_STATS
// environment variable, not per-user state, so there are no write verbs.
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const enabled = isUsageStatsEnabled();

    return NextResponse.json({
      usageStatsEnabled: enabled,
      controlledBy: 'environment',
      message: enabled
        ? 'Usage stats are enabled via ALGA_USAGE_STATS environment variable'
        : 'Usage stats are disabled via ALGA_USAGE_STATS environment variable'
    });
  } catch (error) {
    logger.error('Error getting telemetry preferences:', error);

    return NextResponse.json({
      usageStatsEnabled: false,
      controlledBy: 'environment',
      message: 'Error checking usage stats status'
    });
  }
}