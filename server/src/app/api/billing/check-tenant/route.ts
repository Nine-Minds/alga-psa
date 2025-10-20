import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminConnection } from '@alga-psa/shared/db/admin';

/**
 * Verify webhook signature from nm-store
 * For this endpoint, the signature is computed as: HMAC-SHA256(email:timestamp, secret)
 */
function verifyWebhookSignature(
  signature: string | null,
  email: string,
  timestamp: string | null
): boolean {
  if (!signature || !timestamp) return false;

  const secret = process.env.ALGA_WEBHOOK_SECRET;
  if (!secret) {
    console.error('ALGA_WEBHOOK_SECRET not configured');
    return false;
  }

  const payload = `${email}:${timestamp}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return signature === expectedSignature;
}

/**
 * GET /api/billing/check-tenant?email={email}
 * Checks if a tenant already exists with the given email
 * Called by nm-store during checkout to prevent duplicate tenant creation
 *
 * Response:
 * - 200: Tenant exists { exists: true, tenantId, tenantName }
 * - 404: Tenant does not exist { exists: false }
 * - 400: Invalid request
 * - 401: Unauthorized
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email query parameter is required' },
        { status: 400 }
      );
    }

    // Verify signature
    const signature = req.headers.get('x-webhook-signature');
    const timestamp = req.headers.get('x-timestamp');

    if (!verifyWebhookSignature(signature, email, timestamp)) {
      console.error('[check-tenant] Invalid webhook signature');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[check-tenant] Checking tenant existence for email:', email);

    const knex = await getAdminConnection();

    // Check if tenant exists with this email
    const tenant = await knex('tenants')
      .where('email', email)
      .first('tenant', 'client_name', 'email');

    if (tenant) {
      console.log('[check-tenant] Tenant found:', {
        tenantId: tenant.tenant,
        clientName: tenant.client_name,
      });

      return NextResponse.json({
        exists: true,
        tenantId: tenant.tenant,
        tenantName: tenant.client_name,
      });
    }

    // Also check if any admin user has this email
    // This covers cases where the tenant email differs from the admin email
    const adminUser = await knex('users')
      .where({
        email: email,
        user_type: 'internal',
      })
      .first('tenant');

    if (adminUser) {
      // Found an admin user, get the tenant details
      const userTenant = await knex('tenants')
        .where('tenant', adminUser.tenant)
        .first('tenant', 'client_name', 'email');

      if (userTenant) {
        console.log('[check-tenant] Tenant found via admin user:', {
          tenantId: userTenant.tenant,
          clientName: userTenant.client_name,
        });

        return NextResponse.json({
          exists: true,
          tenantId: userTenant.tenant,
          tenantName: userTenant.client_name,
        });
      }
    }

    // Tenant not found
    console.log('[check-tenant] No tenant found for email:', email);
    return NextResponse.json(
      { exists: false },
      { status: 404 }
    );

  } catch (error) {
    console.error('[check-tenant] Error checking tenant:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
