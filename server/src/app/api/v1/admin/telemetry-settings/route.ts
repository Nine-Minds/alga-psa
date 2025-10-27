import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { isUsageStatsEnabled } from 'server/src/config/telemetry';
import logger from 'server/src/utils/logger';

export async function GET(request: NextRequest) {
  try {
    const { knex, tenant: tenantId } = await createTenantKnex();
    const currentUser = await getCurrentUser();
    
    if (!currentUser || !tenantId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = currentUser.user_id;

    // Verify user has admin permissions
    const userRole = await knex('users')
      .where({ user_id: userId, tenant: tenantId })
      .select('role')
      .first();

    if (!userRole || !['admin', 'owner'].includes(userRole.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const enabled = isUsageStatsEnabled();
    const envVar = process.env.ALGA_USAGE_STATS || 'not set';

    return NextResponse.json({
      usageStatsEnabled: enabled,
      environmentVariable: 'ALGA_USAGE_STATS',
      currentValue: envVar,
      controlledBy: 'environment',
      message: enabled 
        ? 'Usage stats are enabled via ALGA_USAGE_STATS environment variable'
        : 'Usage stats are disabled. Set ALGA_USAGE_STATS=true to enable.'
    });
  } catch (error) {
    logger.error('Error getting tenant telemetry settings:', error);
    return NextResponse.json(
      { error: 'Failed to load settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { knex, tenant: tenantId } = await createTenantKnex();
    const currentUser = await getCurrentUser();
    
    if (!currentUser || !tenantId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = currentUser.user_id;

    // Verify user has admin permissions
    const userRole = await knex('users')
      .where({ user_id: userId, tenant: tenantId })
      .select('role')
      .first();

    if (!userRole || !['admin', 'owner'].includes(userRole.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const enabled = isUsageStatsEnabled();

    return NextResponse.json({
      usageStatsEnabled: enabled,
      controlledBy: 'environment',
      message: 'Telemetry settings are controlled via the ALGA_USAGE_STATS environment variable and cannot be changed through the API'
    });
  } catch (error) {
    logger.error('Error handling telemetry settings update:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}