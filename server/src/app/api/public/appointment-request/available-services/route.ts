import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdBySlug } from '@/lib/actions/tenant-actions/tenantSlugActions';
import { getServicesForPublicBooking } from '@/lib/services/availabilityService';
import logger from '@alga-psa/core/logger';

/**
 * GET /api/public/appointment-request/available-services?tenant={tenant-slug-or-id}
 *
 * Returns list of services that allow public booking without authentication
 *
 * Query Parameters:
 * - tenant: Tenant slug (12-char hex) or tenant ID (UUID)
 *
 * Response:
 * {
 *   "success": true,
 *   "services": [
 *     {
 *       "service_id": "uuid",
 *       "service_name": "Initial Consultation",
 *       "service_description": "30-minute consultation",
 *       "service_type": "consultation",
 *       "default_rate": 150.00,
 *       "duration": 60
 *     }
 *   ]
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantParam = searchParams.get('tenant');

    if (!tenantParam) {
      return NextResponse.json(
        {
          success: false,
          error: 'Tenant parameter is required'
        },
        { status: 400 }
      );
    }

    // Resolve tenant ID from slug if needed
    let tenantId = tenantParam;

    // If tenant looks like a slug (12-char hex), resolve it to UUID
    if (/^[a-f0-9]{12}$/i.test(tenantParam)) {
      const resolvedTenantId = await getTenantIdBySlug(tenantParam);
      if (!resolvedTenantId) {
        logger.warn('[available-services] Invalid tenant slug', {
          slug: tenantParam
        });

        return NextResponse.json(
          {
            success: false,
            error: 'Invalid tenant identifier'
          },
          { status: 400 }
        );
      }
      tenantId = resolvedTenantId;
    }

    // Get services that allow public booking
    const services = await getServicesForPublicBooking(tenantId);

    logger.info('[available-services] Retrieved public services', {
      tenantId,
      serviceCount: services.length
    });

    return NextResponse.json({
      success: true,
      services: services.map(service => ({
        service_id: service.service_id,
        service_name: service.service_name,
        service_description: service.service_description,
        service_type: service.service_type,
        default_rate: service.default_rate,
        duration: service.config_json?.default_duration || null
      }))
    });

  } catch (error) {
    logger.error('[available-services] Error retrieving services', { error });

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
