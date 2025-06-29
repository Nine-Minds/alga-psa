import { NextRequest, NextResponse } from 'next/server';
import { getKnex } from 'server/src/lib/db';
import { getCurrentTenantId } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import HierarchicalTelemetryManager from 'server/src/lib/telemetry/hierarchicalPermissions';
import logger from 'server/src/utils/logger';

export async function GET(request: NextRequest) {
  try {
    const knex = getKnex();
    const currentUser = await getCurrentUser();
    const tenantId = await getCurrentTenantId();
    
    if (!currentUser || !tenantId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    const userId = currentUser.user_id;

    const telemetryManager = new HierarchicalTelemetryManager(knex);
    const decision = await telemetryManager.shouldTrackTelemetry(userId, tenantId);

    return NextResponse.json(decision);
  } catch (error) {
    logger.error('Error getting telemetry decision:', error);
    
    // Return safe defaults on error
    return NextResponse.json({
      allowed: false,
      reason: 'Error checking permissions',
      anonymizationLevel: 'full',
      tenantSettings: {
        enabled: false,
        allowUserOverride: false
      },
      userSettings: {
        optedOut: false,
        canOptOut: false
      }
    });
  }
}