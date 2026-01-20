import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdBySlug } from '@alga-psa/tenancy/actions';
import { getAvailableTimeSlots } from '@/lib/services/availabilityService';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import logger from '@alga-psa/core/logger';
import { z } from 'zod';

// Tenant slug pattern: 12-char lowercase hex
const TENANT_SLUG_REGEX = /^[a-f0-9]{12}$/i;

// UUID pattern for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Get valid IANA timezones for validation (with Node 18 fallback)
function getValidTimezones(): Set<string> {
  try {
    // Node 20+ has Intl.supportedValuesOf
    if (typeof Intl.supportedValuesOf === 'function') {
      return new Set(Intl.supportedValuesOf('timeZone'));
    }
  } catch {
    // Fall through to validation fallback
  }
  // For Node 18, we'll validate by attempting to construct a DateTimeFormat
  return null as unknown as Set<string>;
}

const validTimezones = getValidTimezones();

// Validate timezone by attempting to use it (works on all Node versions)
function isValidTimezone(tz: string): boolean {
  if (validTimezones) {
    return validTimezones.has(tz);
  }
  // Fallback: try to construct a DateTimeFormat with the timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Validation schema for query parameters
const availableSlotsQuerySchema = z.object({
  tenant: z.string().min(1, 'Tenant is required'),
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  duration: z.string()
    .optional()
    .transform(val => val ? parseInt(val, 10) : undefined)
    .refine(val => val === undefined || Number.isFinite(val), 'Duration must be a valid number'),
  timezone: z.string()
    .refine(tz => isValidTimezone(tz), 'Invalid IANA timezone')
    .optional(),
  user_id: z.string().uuid('User ID must be a valid UUID').optional()
});

/**
 * GET /api/public/appointment-request/available-slots?tenant={tenant}&service_id={uuid}&date={YYYY-MM-DD}&duration={minutes}&timezone={tz}&user_id={uuid}
 *
 * Returns available time slots for a specific date and service, along with technicians who allow client preference
 *
 * Query Parameters:
 * - tenant: Tenant slug (12-char hex) or tenant ID (UUID) - required
 * - service_id: Service UUID - required
 * - date: Date in YYYY-MM-DD format - required
 * - duration: Duration in minutes (optional, defaults to service default or 60)
 * - timezone: IANA timezone string (optional, e.g., 'America/New_York') - used for minimum notice calculation
 * - user_id: Optional technician UUID to filter slots by specific technician
 *
 * Response:
 * {
 *   "success": true,
 *   "date": "2025-11-15",
 *   "service_duration": 60,
 *   "slots": [
 *     {
 *       "start_time": "2025-11-15T09:00:00.000Z",
 *       "end_time": "2025-11-15T10:00:00.000Z",
 *       "available": true
 *     }
 *   ],
 *   "technicians": [
 *     {
 *       "user_id": "uuid",
 *       "full_name": "John Smith",
 *       "duration": 60
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
      duration: searchParams.get('duration'),
      timezone: searchParams.get('timezone'),
      user_id: searchParams.get('user_id') || undefined
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
    if (TENANT_SLUG_REGEX.test(validatedParams.tenant)) {
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
    } else if (!UUID_REGEX.test(validatedParams.tenant)) {
      // If not a slug, must be a valid UUID
      logger.warn('[available-slots] Invalid tenant format', {
        tenant: validatedParams.tenant
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Tenant must be a valid slug or UUID'
        },
        { status: 400 }
      );
    }

    // Validate date is not in the past (using UTC)
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const requestedDate = new Date(validatedParams.date + 'T00:00:00Z');

    if (requestedDate < todayUTC) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot request slots for past dates'
        },
        { status: 400 }
      );
    }

    // Execute database operations within tenant context
    return await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      // Get service-specific default duration
      const serviceSettings = await knex('availability_settings')
        .where({
          tenant: tenantId,
          setting_type: 'service_rules',
          service_id: validatedParams.service_id
        })
        .first();

      const serviceDuration = serviceSettings?.config_json?.default_duration || 60;

      // Get available time slots
      const slots = await getAvailableTimeSlots(
        tenantId,
        validatedParams.date,
        validatedParams.service_id,
        validatedParams.duration || serviceDuration,
        validatedParams.user_id,
        validatedParams.timezone
      );

      // Extract unique user IDs from all slots
      const userIds = new Set<string>();
      slots.forEach(slot => {
        slot.available_users.forEach(userId => userIds.add(userId));
      });

      let technicians: { user_id: string; full_name: string; duration: number }[] = [];

      if (userIds.size > 0) {
        // Get user settings for users with slots
        const allUserSettings = await knex('availability_settings')
          .where({
            tenant: tenantId,
            setting_type: 'user_hours'
          })
          .whereIn('user_id', Array.from(userIds))
          .select('user_id', 'config_json');

        // Build map of user-specific durations
        const userDurations: Record<string, number> = {};
        allUserSettings.forEach((setting: any) => {
          if (setting.config_json?.default_duration) {
            userDurations[setting.user_id] = setting.config_json.default_duration;
          }
        });

        // Get technician details - only those with allow_client_preference enabled
        const allowedUserIds = allUserSettings
          .filter((setting: any) => setting.config_json?.allow_client_preference !== false)
          .map((setting: any) => setting.user_id);

        if (allowedUserIds.length > 0) {
          const users = await knex('users')
            .where({ tenant: tenantId })
            .whereIn('user_id', allowedUserIds)
            .select(
              'user_id',
              knex.raw("CONCAT(first_name, ' ', last_name) as full_name")
            );

          technicians = users.map((user: any) => ({
            user_id: user.user_id,
            full_name: user.full_name,
            duration: userDurations[user.user_id] || serviceDuration
          }));
        }
      }

      logger.info('[available-slots] Retrieved available slots', {
        tenantId,
        serviceId: validatedParams.service_id,
        date: validatedParams.date,
        duration: validatedParams.duration || serviceDuration,
        userId: validatedParams.user_id,
        slotCount: slots.length,
        technicianCount: technicians.length
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
        service_duration: serviceDuration,
        slots: formattedSlots,
        technicians
      });
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('[available-slots] Error retrieving slots', {
      message: err.message,
      stack: err.stack
    });

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
