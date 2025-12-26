import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { createTenantKnex } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { providerId } = body;
    if (!providerId) {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
    }

    const { knex, tenant } = await createTenantKnex();
    const provider = await knex('email_providers')
      .where({ id: providerId, tenant, provider_type: 'imap' })
      .first();

    if (!provider) {
      return NextResponse.json({ error: 'IMAP provider not found' }, { status: 404 });
    }

    await knex('imap_email_provider_config')
      .where({ email_provider_id: providerId, tenant })
      .update({
        lease_owner: null,
        lease_expires_at: null,
        updated_at: knex.fn.now(),
      });

    await knex('email_providers')
      .where({ id: providerId, tenant })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('IMAP reconnect error:', error);
    return NextResponse.json({ error: error.message || 'Failed to reconnect IMAP provider' }, { status: 500 });
  }
}
