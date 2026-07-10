import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { createTenantKnex } from '@/lib/db';
import { assertTenantProductAccess, isProductAccessError, toProductAccessDeniedResponse } from '@/lib/productAccess';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await assertTenantProductAccess({
      tenantId: user.tenant,
      capability: 'email_to_ticket',
      allowedProducts: ['psa', 'algadesk'],
    });

    let body: { providerId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
    if (!providerId) {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
    }

    const { knex, tenant } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const provider = await db.table('email_providers')
      .where({ id: providerId, provider_type: 'imap' })
      .first();

    if (!provider) {
      return NextResponse.json({ error: 'IMAP provider not found' }, { status: 404 });
    }

    await db.table('imap_email_provider_config')
      .where({ email_provider_id: providerId })
      .update({
        uid_validity: null,
        last_uid: null,
        last_processed_message_id: null,
        folder_state: {},
        last_error: null,
        updated_at: knex.fn.now(),
      });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (isProductAccessError(error)) {
      return toProductAccessDeniedResponse(error);
    }
    console.error('IMAP resync error:', error);
    return NextResponse.json({ error: 'Failed to resync IMAP provider. Please try again.' }, { status: 500 });
  }
}
