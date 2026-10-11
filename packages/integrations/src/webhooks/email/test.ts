import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { buildInboundEmailReceivedPayload } from '@alga-psa/shared/workflow/streams/domainEventBuilders/emailLifecycleEventBuilders';

// Test endpoint to verify webhook and event publishing
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { provider = 'microsoft', messageId = 'test-message-123' } = body;

    // Publish test event
    const receivedAt = new Date().toISOString();
    const eventId = randomUUID();
    await publishWorkflowEvent({
      eventType: 'INBOUND_EMAIL_RECEIVED',
      payload: buildInboundEmailReceivedPayload({
        tenant: user.tenant,
        providerId: 'test-provider',
        emailData: {
          id: messageId,
          from: { email: 'test@example.com' },
          to: [{ email: 'support@example.com' }],
          subject: `Test webhook event (${provider})`,
          body: { text: 'Synthetic INBOUND_EMAIL_RECEIVED published by the webhook test endpoint.' },
          receivedAt,
          tenant: user.tenant,
          providerId: 'test-provider',
        },
      }),
      ctx: { tenantId: user.tenant, occurredAt: receivedAt, actor: { actorType: 'USER', actorUserId: user.user_id } },
    }, { eventId });

    return NextResponse.json({
      success: true,
      message: 'Test event published successfully',
      eventId,
      tenant: user.tenant
    });

  } catch (error: any) {
    console.error('Test webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to publish test event.' },
      { status: 500 }
    );
  }
}
