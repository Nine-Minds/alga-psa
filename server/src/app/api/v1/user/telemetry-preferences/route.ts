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

export async function POST(request: NextRequest) {
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
      message: 'Telemetry preferences are controlled via the ALGA_USAGE_STATS environment variable and cannot be changed through the API'
    });
  } catch (error) {
    logger.error('Error handling telemetry preferences update:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    
    if (!currentUser) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    return NextResponse.json({
      message: 'Telemetry preferences are controlled via the ALGA_USAGE_STATS environment variable and cannot be changed through the API'
    });
  } catch (error) {
    logger.error('Error handling telemetry disable request:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}