import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdBySlug } from '@/lib/actions/tenant-actions/tenantSlugActions';
import { getAvailableDates } from '@/lib/services/availabilityService';
import logger from '@alga-psa/shared/core/logger';
import { z } from 'zod';

// Validation schema for query parameters
const availableDatesQuerySchema = z.object({
  tenant: z.string().min(1, 'Tenant is required'),
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format').optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format').optional(),
  user_id: z.string().uuid('User ID must be a valid UUID').optional(),
  timezone: z.string().optional()
});

/**
 * GET /api/public/appointment-request/available-dates?tenant={tenant}&service_id={uuid}&start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}&user_id={uuid}&timezone={tz}
 *
 * Returns dates with availability for a specific service within a date range
 *
 * Query Parameters:
 * - tenant: Tenant slug (12-char hex) or tenant ID (UUID) - required
 * - service_id: Service UUID - required
 * - start_date: Start of date range in YYYY-MM-DD format (optional, defaults to today)
 * - end_date: End of date range in YYYY-MM-DD format (optional, defaults to 30 days from start)
 * - user_id: Optional technician UUID to filter availability by specific technician
 * - timezone: IANA timezone string (optional, e.g., 'America/New_York') - used for minimum notice calculation
 *
 * Response:
 * {
 *   "success": true,
 *   "dates": [
 *     {
 *       "date": "2025-01-15",
 *       "has_availability": true,
 *       "slot_count": 8
 *     }
 *   ]
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Extract and validate query parameters
    const queryParams = {
      tenant: searchParams.get('tenant'),
      service_id: searchParams.get('service_id'),
      start_date: searchParams.get('start_date') || undefined,
      end_date: searchParams.get('end_date') || undefined,
      user_id: searchParams.get('user_id') || undefined,
      timezone: searchParams.get('timezone') || undefined
    };

    let validatedParams;
    try {
      validatedParams = availableDatesQuerySchema.parse(queryParams);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('[available-dates] Validation error', {
          errors: error.errors
        });

        return NextResponse.json(
          {
            success: false,
            error: 'Invalid query parameters',
            details: error.errors
          },
          { status: 400 }
        );
      }
      throw error;
    }

    // Resolve tenant ID from slug if needed
    let tenantId = validatedParams.tenant;

    // If tenant looks like a slug (12-char hex), resolve it to UUID
    if (/^[a-f0-9]{12}$/i.test(validatedParams.tenant)) {
      const resolvedTenantId = await getTenantIdBySlug(validatedParams.tenant);
      if (!resolvedTenantId) {
        logger.warn('[available-dates] Invalid tenant slug', {
          slug: validatedParams.tenant
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

    // Calculate default date range (today to 30 days from now)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const defaultStartDate = today.toISOString().split('T')[0];
    const defaultEndDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const startDate = validatedParams.start_date || defaultStartDate;
    const endDate = validatedParams.end_date || defaultEndDate;

    // Validate start_date is not in the past
    const requestedStartDate = new Date(startDate);
    if (requestedStartDate < today) {
      return NextResponse.json(
        {
          success: false,
          error: 'Start date cannot be in the past'
        },
        { status: 400 }
      );
    }

    // Validate end_date is after start_date
    const requestedEndDate = new Date(endDate);
    if (requestedEndDate < requestedStartDate) {
      return NextResponse.json(
        {
          success: false,
          error: 'End date must be after start date'
        },
        { status: 400 }
      );
    }

    // Limit date range to 90 days to prevent excessive queries
    const maxEndDate = new Date(requestedStartDate.getTime() + 90 * 24 * 60 * 60 * 1000);
    const limitedEndDate = requestedEndDate > maxEndDate
      ? maxEndDate.toISOString().split('T')[0]
      : endDate;

    // Get available dates
    const dates = await getAvailableDates(
      tenantId,
      validatedParams.service_id,
      startDate,
      limitedEndDate,
      validatedParams.user_id,
      validatedParams.timezone
    );

    logger.info('[available-dates] Retrieved available dates', {
      tenantId,
      serviceId: validatedParams.service_id,
      startDate,
      endDate: limitedEndDate,
      userId: validatedParams.user_id,
      dateCount: dates.length,
      availableDateCount: dates.filter(d => d.has_availability).length
    });

    return NextResponse.json({
      success: true,
      dates
    });

  } catch (error) {
    logger.error('[available-dates] Error retrieving dates', { error });

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
