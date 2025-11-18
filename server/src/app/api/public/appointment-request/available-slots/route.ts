import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdBySlug } from '@/lib/actions/tenant-actions/tenantSlugActions';
import { getAvailableTimeSlots } from '@/lib/services/availabilityService';
import logger from '@alga-psa/shared/core/logger';
import { z } from 'zod';

// Validation schema for query parameters
const availableSlotsQuerySchema = z.object({
  tenant: z.string().min(1, 'Tenant is required'),
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  duration: z.string().optional().transform(val => val ? parseInt(val, 10) : 60),
  timezone: z.string().optional()
});

/**
 * GET /api/public/appointment-request/available-slots?tenant={tenant}&service_id={uuid}&date={YYYY-MM-DD}&duration={minutes}&timezone={tz}
 *
 * Returns available time slots for a specific date and service
 *
 * Query Parameters:
 * - tenant: Tenant slug (12-char hex) or tenant ID (UUID) - required
 * - service_id: Service UUID - required
 * - date: Date in YYYY-MM-DD format - required
 * - duration: Duration in minutes (optional, defaults to 60)
 * - timezone: IANA timezone string (optional, e.g., 'America/New_York') - used for minimum notice calculation
 *
 * Response:
 * {
 *   "success": true,
 *   "date": "2025-11-15",
 *   "slots": [
 *     {
 *       "start_time": "2025-11-15T09:00:00.000Z",
 *       "end_time": "2025-11-15T10:00:00.000Z",
 *       "available": true
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
      date: searchParams.get('date'),
      duration: searchParams.get('duration')
    };

    let validatedParams;
    try {
      validatedParams = availableSlotsQuerySchema.parse(queryParams);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('[available-slots] Validation error', {
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
        logger.warn('[available-slots] Invalid tenant slug', {
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

    // Validate date is not in the past
    const requestedDate = new Date(validatedParams.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (requestedDate < today) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot request slots for past dates'
        },
        { status: 400 }
      );
    }

    // Get available time slots
    const slots = await getAvailableTimeSlots(
      tenantId,
      validatedParams.date,
      validatedParams.service_id,
      validatedParams.duration,
      undefined, // userId - not supported in public API
      validatedParams.timezone
    );

    logger.info('[available-slots] Retrieved available slots', {
      tenantId,
      serviceId: validatedParams.service_id,
      date: validatedParams.date,
      duration: validatedParams.duration,
      slotCount: slots.length
    });

    // Format slots for public API response
    const formattedSlots = slots.map(slot => ({
      start_time: slot.start_time,
      end_time: slot.end_time,
      available: slot.is_available
    }));

    return NextResponse.json({
      success: true,
      date: validatedParams.date,
      slots: formattedSlots
    });

  } catch (error) {
    logger.error('[available-slots] Error retrieving slots', { error });

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
