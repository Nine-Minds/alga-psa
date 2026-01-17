import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminConnection } from '@alga-psa/db/admin';
import type { Knex } from 'knex';

/**
 * Verify webhook signature from nm-store
 */
function verifyWebhookSignature(signature: string | null, payload: string): boolean {
  if (!signature) return false;
  
  const secret = process.env.ALGA_WEBHOOK_SECRET;
  if (!secret) {
    console.error('ALGA_WEBHOOK_SECRET not configured');
    return false;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return signature === expectedSignature;
}

/**
 * POST /api/billing/licence-count
 * Updates the tenant's license count from Stripe subscription data
 * Called by nm-store when subscription is created or updated
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('x-webhook-signature');
    
    // Verify signature
    if (!verifyWebhookSignature(signature, body)) {
      console.error('Invalid webhook signature');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const data = JSON.parse(body);
    const { tenant_id, license_count, event_id } = data;
    
    // Validate input
    if (!tenant_id || typeof license_count !== 'number') {
      return NextResponse.json(
        { error: 'Invalid input: tenant_id and license_count are required' },
        { status: 400 }
      );
    }
    
    console.log(`Updating license count for tenant ${tenant_id} to ${license_count}`);
    
    const knex = await getAdminConnection();
    
    await knex.transaction(async (trx: Knex.Transaction) => {
      // Check for idempotency if event ID is provided
      if (event_id) {
        const existing = await trx('tenants')
          .where({ 
            tenant: tenant_id,
            stripe_event_id: event_id 
          })
          .first();
        
        if (existing) {
          console.log('Event already processed, skipping update', { 
            tenantId: tenant_id,
            eventId: event_id 
          });
          return;
        }
      }
      
      // Update the tenant's license count
      const result = await trx('tenants')
        .where({ tenant: tenant_id })
        .update({
          licensed_user_count: license_count,
          last_license_update: knex.fn.now(),
          stripe_event_id: event_id || null,
          updated_at: knex.fn.now()
        });
      
      if (result === 0) {
        throw new Error(`Tenant not found: ${tenant_id}`);
      }
      
      console.log(`Successfully updated tenant ${tenant_id} license count to ${license_count}`);
    });
    
    return NextResponse.json({
      success: true,
      tenant_id,
      license_count,
      updated_at: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Error updating license count:', error);
    
    if (error instanceof Error && error.message.includes('Tenant not found')) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/billing/licence-count/[tenantId]
 * Returns the current license usage for a tenant
 * Secured endpoint for nm-store to query current usage
 */
export async function GET(req: NextRequest) {
  try {
    // Verify webhook signature for GET requests too
    const signature = req.headers.get('x-webhook-signature');
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenant_id');
    
    if (!tenantId) {
      return NextResponse.json(
        { error: 'tenant_id query parameter is required' },
        { status: 400 }
      );
    }
    
    // Create a payload for signature verification (using query params)
    const payload = `GET:${tenantId}`;
    
    if (!verifyWebhookSignature(signature, payload)) {
      console.error('Invalid webhook signature for GET request');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Log the request for monitoring
    console.log('License usage query', {
      tenantId,
      requestIp: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    const knex = await getAdminConnection();
    
    // Get the tenant's license limit
    const tenant = await knex('tenants')
      .where({ tenant: tenantId })
      .first('licensed_user_count', 'last_license_update');
    
    if (!tenant) {
      return NextResponse.json(
        { error: `Tenant not found: ${tenantId}` },
        { status: 404 }
      );
    }
    
    // Count active MSP (internal) users
    const usedResult = await knex('users')
      .where({ 
        tenant: tenantId,
        user_type: 'internal',
        is_inactive: false 
      })
      .count('* as count');
    
    const used = parseInt(usedResult[0].count as string, 10);
    const limit = tenant.licensed_user_count;
    const remaining = limit !== null ? Math.max(0, limit - used) : null;
    
    return NextResponse.json({
      tenant_id: tenantId,
      limit,
      used,
      remaining,
      last_updated: tenant.last_license_update || null,
    });
    
  } catch (error) {
    console.error('Error fetching license usage:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}