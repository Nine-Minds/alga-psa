import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { isUsageStatsEnabled } from 'server/src/config/telemetry';
import logger from 'server/src/utils/logger';

export const dynamic = 'force-dynamic'

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
      enabled,
      reason: enabled ? 'Usage stats enabled via environment variable' : 'Usage stats disabled'
    });
  } catch (error) {
    logger.error('Error getting telemetry decision:', error);
    
    // Return safe defaults on error
    return NextResponse.json({
      enabled: false,
      reason: 'Error checking usage stats status'
    });
  }
}