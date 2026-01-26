import { NextRequest, NextResponse } from 'next/server';
import { publishEvent } from '@alga-psa/shared/events/publisher';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

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
    const eventId = await publishEvent({
      eventType: 'INBOUND_EMAIL_RECEIVED',
      tenant: user.tenant,
      payload: {
        providerId: 'test-provider',
        providerType: provider,
        mailbox: 'test@example.com',
        messageId: messageId,
        webhookData: {
          test: true,
          timestamp: new Date().toISOString()
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Test event published successfully',
      eventId,
      tenant: user.tenant
    });

  } catch (error: any) {
    console.error('Test webhook error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to publish test event' },
      { status: 500 }
    );
  }
}
