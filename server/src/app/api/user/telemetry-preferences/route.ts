import { NextRequest, NextResponse } from 'next/server';
import { getKnex } from 'server/src/lib/db';
import { getCurrentUserId, getCurrentTenantId } from 'server/src/lib/db';
import TelemetryPreferencesModel from 'server/src/lib/models/telemetryPreferences';
import { TELEMETRY_CONFIG } from 'server/src/config/telemetry';
import logger from 'server/src/utils/logger';

export async function GET(request: NextRequest) {
  try {
    const knex = getKnex();
    const userId = await getCurrentUserId();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const preferences = await TelemetryPreferencesModel.getTelemetryPreferences(
      knex,
      userId
    );

    const tenantId = await getCurrentTenantId();
    const response = {
      ...preferences,
      tenant_id: tenantId || '',
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Error getting telemetry preferences:', error);
    
    // Return safe defaults on error
    const userId = await getCurrentUserId().catch(() => 'unknown');
    return NextResponse.json({
      ...TELEMETRY_CONFIG.DEFAULT_PREFERENCES,
      last_updated: new Date().toISOString(),
      consent_version: TELEMETRY_CONFIG.PRIVACY.CONSENT_VERSION,
      user_id: userId,
      tenant_id: '',
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const knex = getKnex();
    const userId = await getCurrentUserId();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Validate the request body
    const validCategories = Object.keys(TELEMETRY_CONFIG.DEFAULT_PREFERENCES);
    const preferences: Record<string, boolean> = {};
    
    for (const category of validCategories) {
      if (category in body) {
        preferences[category] = Boolean(body[category]);
      }
    }

    // Save preferences
    await TelemetryPreferencesModel.setTelemetryPreferences(
      knex,
      userId,
      preferences
    );

    // Return updated preferences
    const updatedPreferences = await TelemetryPreferencesModel.getTelemetryPreferences(
      knex,
      userId
    );

    const tenantId = await getCurrentTenantId();
    const response = {
      ...updatedPreferences,
      tenant_id: tenantId || '',
    };

    logger.info(`Updated telemetry preferences for user ${userId}`, {
      userId,
      enabledCategories: Object.entries(preferences).filter(([_, enabled]) => enabled).map(([category]) => category),
      totalCategories: Object.keys(preferences).length
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Error saving telemetry preferences:', error);
    return NextResponse.json(
      { error: 'Failed to save preferences' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const knex = getKnex();
    const userId = await getCurrentUserId();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Disable all telemetry for the user
    await TelemetryPreferencesModel.disableAllTelemetry(knex, userId);

    logger.info(`Disabled all telemetry for user ${userId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error disabling telemetry:', error);
    return NextResponse.json(
      { error: 'Failed to disable telemetry' },
      { status: 500 }
    );
  }
}