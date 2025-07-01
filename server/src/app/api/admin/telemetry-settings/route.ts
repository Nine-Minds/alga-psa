import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import TenantTelemetrySettingsModel from 'server/src/lib/models/tenantTelemetrySettings';
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

    const settings = await TenantTelemetrySettingsModel.getTenantTelemetrySettings(
      knex,
      tenantId
    );

    return NextResponse.json(settings);
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

    const body = await request.json();
    
    // Validate the request body
    const allowedFields = [
      'enabled', 'allowUserOverride', 'anonymizationLevel', 
      'excludePatterns', 'complianceNotes'
    ];
    
    const updates: any = {};
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    // Update settings
    const updatedSettings = await TenantTelemetrySettingsModel.updateTenantTelemetrySettings(
      knex,
      updates,
      tenantId
    );

    // Log the consent change for compliance
    await TenantTelemetrySettingsModel.logConsentChange(knex, {
      tenantId,
      consentGiven: updatedSettings.enabled,
      changedBy: userId,
      reason: `Tenant settings updated: enabled=${updatedSettings.enabled}, allowUserOverride=${updatedSettings.allowUserOverride}`,
      ipAddress: request.ip || request.headers.get('x-forwarded-for') || 'unknown'
    });

    logger.info(`Updated tenant telemetry settings for tenant ${tenantId}`, {
      tenantId,
      updatedBy: userId,
      enabled: updatedSettings.enabled,
      allowUserOverride: updatedSettings.allowUserOverride
    });

    return NextResponse.json(updatedSettings);
  } catch (error) {
    logger.error('Error saving tenant telemetry settings:', error);
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    );
  }
}