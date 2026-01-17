import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/db/admin';

/**
 * POST /api/internal/check-tenant-email
 * Checks if a tenant with the given email exists in AlgaPSA
 * Called by nm-store to validate if a user should create a new account or add licenses
 *
 * This endpoint is protected by X-Internal-Secret header (ALGA_AUTH_KEY)
 */
export async function POST(req: NextRequest) {
  try {
    // Verify authentication
    const apiSecret = req.headers.get('x-internal-secret');
    const expectedSecret = process.env.ALGA_AUTH_KEY;

    if (!apiSecret || !expectedSecret || apiSecret !== expectedSecret) {
      console.error('Unauthorized check-tenant-email request');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log('Checking tenant email existence', { email: normalizedEmail });

    const knex = await getAdminConnection();

    // Check if any internal (MSP) user with this email exists
    const user = await knex('users')
      .where({
        email: normalizedEmail,
        user_type: 'internal'
      })
      .first('tenant', 'user_id', 'email');

    if (user) {
      console.log('Tenant email exists', {
        email: normalizedEmail,
        tenantId: user.tenant
      });

      return NextResponse.json({
        exists: true,
        tenantId: user.tenant,
        email: user.email
      });
    }

    console.log('Tenant email does not exist', { email: normalizedEmail });

    return NextResponse.json({
      exists: false
    });

  } catch (error) {
    console.error('Error checking tenant email:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
