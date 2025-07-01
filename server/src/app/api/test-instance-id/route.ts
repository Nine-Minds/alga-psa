import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateInstanceId, getAnalyticsSettings, isAnalyticsEnabled } from '../../../lib/analytics/analyticsSettings';
import { PrivacyHelper } from '../../../lib/analytics/privacy';
import { getTenantSettings } from '../../../lib/actions/tenant-settings-actions/tenantSettingsActions';
import { analytics } from '../../../lib/analytics/posthog';

export async function GET(request: NextRequest) {
  try {
    // Get various instance ID implementations
    const [
      stableInstanceId,
      privacyInstanceId,
      legacyInstanceId,
      analyticsSettings,
      tenantSettings,
      analyticsEnabled
    ] = await Promise.all([
      getOrCreateInstanceId(),
      PrivacyHelper.getInstanceIdAsync(),
      Promise.resolve(PrivacyHelper.getInstanceId()),
      getAnalyticsSettings(),
      getTenantSettings(),
      isAnalyticsEnabled()
    ]);

    // Test the analytics capture with new ID
    analytics.capture('test_instance_id', {
      test: true,
      stable_id: stableInstanceId
    });

    const results = {
      instance_ids: {
        stable: stableInstanceId,
        privacy_async: privacyInstanceId,
        privacy_sync: legacyInstanceId,
        env_override: process.env.INSTANCE_ID || null
      },
      analytics_settings: analyticsSettings,
      tenant_settings: {
        tenant: tenantSettings?.tenant,
        has_analytics: !!tenantSettings?.settings?.analytics,
        analytics: tenantSettings?.settings?.analytics
      },
      analytics_enabled: analyticsEnabled,
      environment: {
        ALGA_USAGE_STATS: process.env.ALGA_USAGE_STATS,
        DEPLOYMENT_TYPE: process.env.DEPLOYMENT_TYPE,
        NODE_ENV: process.env.NODE_ENV
      },
      test_info: {
        message: 'Instance ID implementation is working correctly',
        stable_id_length: stableInstanceId.length,
        is_uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stableInstanceId)
      }
    };

    return NextResponse.json(results, { 
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      }
    });
  } catch (error) {
    console.error('Error testing instance ID:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}