import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import {
  createPublicAppointmentRequestSchema,
  CreatePublicAppointmentRequestInput
} from '@/lib/schemas/appointmentSchemas';
import { getTenantIdBySlug } from '@/lib/actions/tenant-actions/tenantSlugActions';
import { getConnection } from '@/lib/db/db';
import { getServicesForPublicBooking } from '@/lib/services/availabilityService';
import { SystemEmailService } from '@/lib/email/system/SystemEmailService';
import {
  getTenantSettings,
  getScheduleApprovers,
  formatDate,
  formatTime
} from '@/lib/actions/appointmentHelpers';
import logger from '@alga-psa/shared/core/logger';
import { z } from 'zod';

// Rate limiter for public appointment requests (IP-based)
// 5 requests per hour per IP address
const appointmentRequestLimiter = new RateLimiterMemory({
  points: 5,
  duration: 3600, // 1 hour
  blockDuration: 3600, // Block for 1 hour after limit exceeded
});

/**
 * Get client IP address from request
 */
function getClientIp(req: NextRequest): string {
  // Check various headers for IP address (handling proxies)
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');

  if (cfConnectingIp) return cfConnectingIp;
  if (realIp) return realIp;
  if (forwarded) return forwarded.split(',')[0].trim();

  return 'unknown';
}

/**
 * Check rate limit for IP address
 */
async function checkRateLimit(ip: string): Promise<{ allowed: boolean; msBeforeNext?: number }> {
  try {
    await appointmentRequestLimiter.consume(ip);
    return { allowed: true };
  } catch (error: any) {
    const msBeforeNext = error?.msBeforeNext || 3600000;
    return { allowed: false, msBeforeNext };
  }
}

/**
 * Generate a human-readable reference number for the appointment request
 */
function generateReferenceNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `APT-${timestamp}-${random}`;
}

/**
 * POST /api/public/appointment-request
 *
 * Create a public appointment request (unauthenticated)
 *
 * Security:
 * - IP-based rate limiting (5 requests per hour)
 * - Input validation and sanitization
 * - Tenant validation
 *
 * Request body:
 * {
 *   "tenant": "tenant-slug-or-id",
 *   "name": "John Doe",
 *   "email": "john@example.com",
 *   "phone": "+1234567890",
 *   "company": "Acme Corp",
 *   "service_id": "uuid",
 *   "requested_date": "2025-11-15",
 *   "requested_time": "14:00",
 *   "requested_duration": 60,
 *   "message": "Optional description"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "reference_number": "APT-12345",
 *   "message": "Your appointment request has been received..."
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // Get client IP for rate limiting
    const clientIp = getClientIp(req);

    // Check rate limit
    const rateLimitResult = await checkRateLimit(clientIp);
    if (!rateLimitResult.allowed) {
      const minutes = rateLimitResult.msBeforeNext
        ? Math.ceil(rateLimitResult.msBeforeNext / 1000 / 60)
        : 60;

      logger.warn('[public-appointment-request] Rate limit exceeded', {
        ip: clientIp,
        minutesUntilReset: minutes
      });

      return NextResponse.json(
        {
          success: false,
          error: `Too many appointment requests. Please try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`
        },
        { status: 429 }
      );
    }

    // Parse and validate request body
    const body = await req.json();

    let validatedData: CreatePublicAppointmentRequestInput;
    try {
      validatedData = createPublicAppointmentRequestSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('[public-appointment-request] Validation error', {
          errors: error.errors,
          ip: clientIp
        });

        return NextResponse.json(
          {
            success: false,
            error: 'Invalid request data',
            details: error.errors
          },
          { status: 400 }
        );
      }
      throw error;
    }

    // Resolve tenant ID from tenant slug/ID
    let tenantId = validatedData.tenant;

    // If tenant looks like a slug (12-char hex), resolve it to UUID
    if (/^[a-f0-9]{12}$/i.test(validatedData.tenant)) {
      const resolvedTenantId = await getTenantIdBySlug(validatedData.tenant);
      if (!resolvedTenantId) {
        logger.warn('[public-appointment-request] Invalid tenant slug', {
          slug: validatedData.tenant,
          ip: clientIp
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

    // Verify tenant exists
    const knex = await getConnection(tenantId);
    const tenant = await knex('tenants')
      .where({ tenant: tenantId })
      .first('tenant', 'client_name');

    if (!tenant) {
      logger.warn('[public-appointment-request] Tenant not found', {
        tenantId,
        ip: clientIp
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid tenant'
        },
        { status: 400 }
      );
    }

    // Verify service exists and allows public booking
    const publicServices = await getServicesForPublicBooking(tenantId);
    const service = publicServices.find(s => s.service_id === validatedData.service_id);

    if (!service) {
      logger.warn('[public-appointment-request] Service not available for public booking', {
        serviceId: validatedData.service_id,
        tenantId,
        ip: clientIp
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Service not available for public booking'
        },
        { status: 400 }
      );
    }

    // Use service default duration if not provided
    const requestedDuration = validatedData.requested_duration || 60;

    // Generate reference number
    const referenceNumber = generateReferenceNumber();

    // Create appointment request
    const appointmentRequestId = uuidv4();
    const now = new Date();

    await knex('appointment_requests').insert({
      appointment_request_id: appointmentRequestId,
      tenant: tenantId,
      client_id: null,
      contact_id: null,
      service_id: validatedData.service_id,
      requested_date: validatedData.requested_date,
      requested_time: validatedData.requested_time,
      requested_duration: requestedDuration,
      preferred_assigned_user_id: null,
      status: 'pending',
      description: validatedData.message || null,
      ticket_id: null,
      is_authenticated: false,
      requester_name: validatedData.name,
      requester_email: validatedData.email,
      requester_phone: validatedData.phone || null,
      company_name: validatedData.company || null,
      schedule_entry_id: null,
      approved_by_user_id: null,
      approved_at: null,
      declined_reason: null,
      created_at: now,
      updated_at: now,
    });

    logger.info('[public-appointment-request] Appointment request created', {
      appointmentRequestId,
      tenantId,
      serviceId: validatedData.service_id,
      requesterEmail: validatedData.email,
      referenceNumber,
      ip: clientIp
    });

    // Send confirmation email to requester
    try {
      const emailService = SystemEmailService.getInstance();

      // Get tenant settings
      const tenantSettings = await getTenantSettings(tenantId);

      // Send confirmation email to requester using template
      await emailService.sendAppointmentRequestReceived({
        requesterName: validatedData.name,
        requesterEmail: validatedData.email,
        serviceName: service.service_name,
        requestedDate: await formatDate(validatedData.requested_date, 'en'),
        requestedTime: await formatTime(validatedData.requested_time, 'en'),
        duration: service.default_duration || 60,
        referenceNumber: referenceNumber,
        responseTime: '24 hours',
        portalLink: process.env.NEXT_PUBLIC_APP_URL || 'https://app.algapsa.com',
        contactEmail: tenantSettings.contactEmail,
        contactPhone: tenantSettings.contactPhone
      }, {
        tenantId: tenantId
      });

      logger.info('[public-appointment-request] Confirmation email sent', {
        appointmentRequestId,
        email: validatedData.email
      });
    } catch (emailError) {
      // Log error but don't fail the request
      logger.error('[public-appointment-request] Failed to send confirmation email', {
        appointmentRequestId,
        email: validatedData.email,
        error: emailError
      });
    }

    // Send notification email to MSP staff
    try {
      const emailService = SystemEmailService.getInstance();

      // Get tenant settings
      const tenantSettings = await getTenantSettings(tenantId);

      // Get staff users who can approve appointment requests
      const staffUsers = await getScheduleApprovers(tenantId);

      for (const staffUser of staffUsers) {
        await emailService.sendNewAppointmentRequest(staffUser.email, {
          requesterName: validatedData.name,
          requesterEmail: validatedData.email,
          requesterPhone: validatedData.phone || undefined,
          companyName: validatedData.company || undefined,
          clientName: validatedData.company || 'Public Request',
          serviceName: service.service_name,
          requestedDate: await formatDate(validatedData.requested_date, 'en'),
          requestedTime: await formatTime(validatedData.requested_time, 'en'),
          duration: service.default_duration || 60,
          preferredTechnician: 'Not specified',
          description: validatedData.message || undefined,
          referenceNumber: referenceNumber,
          submittedAt: new Date().toISOString(),
          isAuthenticated: false,
          approvalLink: `${process.env.NEXT_PUBLIC_APP_URL}/msp/schedule`,
          contactEmail: tenantSettings.contactEmail,
          contactPhone: tenantSettings.contactPhone
        }, {
          tenantId: tenantId
        });
      }

      logger.info('[public-appointment-request] MSP staff notifications sent', {
        appointmentRequestId,
        staffUsersCount: staffUsers.length
      });
    } catch (emailError) {
      // Log error but don't fail the request
      logger.error('[public-appointment-request] Failed to send MSP staff notifications', {
        appointmentRequestId,
        error: emailError
      });
    }

    return NextResponse.json({
      success: true,
      reference_number: referenceNumber,
      message: 'Your appointment request has been received and is pending approval. You will receive a confirmation email once it is reviewed.'
    });

  } catch (error) {
    logger.error('[public-appointment-request] Error processing request', { error });

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
