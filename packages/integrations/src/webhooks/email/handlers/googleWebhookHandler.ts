import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/db/admin';
import { OAuth2Client } from 'google-auth-library';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { enqueueUnifiedInboundEmailQueueJob } from '@alga-psa/shared/services/email/unifiedInboundEmailQueue';

interface GooglePubSubMessage {
  message: {
    data: string; // Base64 encoded
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

async function assertTenantEmailProductAccess(knex: any, tenantId: string): Promise<void> {
  const tenant = await knex('tenants').where({ tenant: tenantId }).first('product_code');
  const productCode = typeof tenant?.product_code === 'string' ? tenant.product_code : 'psa';
  if (productCode !== 'psa' && productCode !== 'algadesk') {
    const error = new Error(`Product access denied for tenant ${tenantId}`) as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

function isRetryableWebhookError(error: any): boolean {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  if (Number.isFinite(status)) {
    if (status === 429) return true;
    if (status >= 500) return true;
    if (status >= 400) return false;
  }

  const code = String(error?.code || '').toUpperCase();
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return true;
  }

  const message = String(error?.message || '').toLowerCase();
  if (message.includes('timeout') || message.includes('redis') || message.includes('connection')) {
    return true;
  }
  if (error instanceof SyntaxError || message.includes('json')) {
    return false;
  }

  // Unknown failures default to retryable to prevent silent message loss.
  return true;
}

export async function handleGoogleWebhook(request: NextRequest) {
  // Initialize variables that might be needed in catch block
  let payloadData: { messageId?: string; publishTime?: string; subscription?: string } = {};
  
  try {
    // Parse Pub/Sub payload
    const payload: GooglePubSubMessage = await request.json();
    
    // Add detailed logging of the incoming message structure
    console.log('🔔 Google Pub/Sub webhook notification received:', {
      messageId: payload.message?.messageId,
      subscription: payload.subscription,
      timestamp: new Date().toISOString(),
      hasMessageData: !!payload.message?.data,
      fullPayload: JSON.stringify(payload, null, 2)
    });
    
    // Debug: Log the complete payload structure
    console.log('🔍 Complete payload structure:', {
      payload: payload,
      messageKeys: payload.message ? Object.keys(payload.message) : 'No message object',
      subscriptionType: typeof payload.subscription,
      subscriptionValue: payload.subscription
    });

    if (!payload.message?.data) {
      console.log('⚠️  No message data in Pub/Sub payload, skipping processing');
      return NextResponse.json({ success: true, message: 'No data to process' });
    }

    // Require JWT token (required for security)
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('❌ No JWT token provided - Pub/Sub notifications must include JWT tokens');
      return NextResponse.json({ error: 'Unauthorized - JWT token required' }, { status: 401 });
    }
    const token = authHeader.substring(7);

    // Decode base64 message data
    console.log('🔓 Decoding base64 message data');
    const decodedData = Buffer.from(payload.message.data, 'base64').toString();
    const notification: GmailNotification = JSON.parse(decodedData);

    console.log('📧 Decoded Gmail notification:', {
      emailAddress: notification.emailAddress,
      historyId: notification.historyId
    });

    const knex = await getAdminConnection();
    
    // Store payload data to ensure it's accessible in all scopes
    payloadData = {
      messageId: payload.message.messageId,
      publishTime: payload.message.publishTime,
      subscription: payload.subscription
    };
    
    console.log('🔍 Payload data extracted for processing:', payloadData);

    // Resolve provider + google config BEFORE doing any side effects, so we can validate JWT issuer
    const subscriptionName = payloadData.subscription?.split('/').pop();
    console.log(`🔔 Subscription name extracted: ${subscriptionName}`);

    let provider = null as any;
    let googleConfig = null as any;

    if (subscriptionName) {
      try {
        const cfg = await knex('google_email_provider_config')
          .select('email_provider_id')
          .where('pubsub_subscription_name', subscriptionName)
          .first();
        if (cfg?.email_provider_id) {
          provider = await knex('email_providers')
            .where('id', cfg.email_provider_id)
            .andWhere('provider_type', 'google')
            .andWhere('is_active', true)
            .first();
          if (provider) {
            console.log(`✅ Mapped provider via subscription ${subscriptionName}: ${provider.id}`);
          }
        }
      } catch (mapErr: any) {
        console.warn('⚠️ Failed subscription→provider mapping, will fallback to email lookup:', mapErr?.message || mapErr);
      }
    }

    if (!provider) {
      console.log(`🔍 Looking up Gmail provider by address: ${notification.emailAddress}`);
      provider = await knex('email_providers')
        .where('mailbox', notification.emailAddress)
        .andWhere('provider_type', 'google')
        .andWhere('is_active', true)
        .first();
    }

    if (!provider) {
      console.error(`❌ Active Gmail provider not found (subscription=${subscriptionName} email=${notification.emailAddress})`);
      return NextResponse.json({ success: true, message: 'No provider found' });
    }
    await assertTenantEmailProductAccess(knex, provider.tenant);

    console.log(`✅ Found Gmail provider: ${provider.id} for ${notification.emailAddress}`);

    googleConfig = await knex('google_email_provider_config')
      .where('email_provider_id', provider.id)
      .first();

    if (!googleConfig) {
      console.error(`❌ Google config not found for provider: ${provider.id}`);
      return NextResponse.json({ success: true, message: 'No google config found' });
    }

    // Verify JWT token (audience + issuer), now that we know which tenant/provider this webhook maps to
    // Use NEXTAUTH_URL or NEXT_PUBLIC_BASE_URL for the expected audience since request.nextUrl.origin
    // returns the container's internal URL (e.g., https://localhost:3000) instead of the public URL
    const baseUrl = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const webhookUrl = baseUrl ? `${baseUrl}${request.nextUrl.pathname}` : `${request.nextUrl.origin}${request.nextUrl.pathname}`;
    console.log('🔐 Verifying JWT token from Pub/Sub', {
      webhookUrl,
      providerId: provider.id,
      tenant: provider.tenant,
      projectId: googleConfig.project_id,
    });

    try {
      const secretProvider = await getSecretProviderInstance();
      const serviceAccountKey = await secretProvider.getTenantSecret(provider.tenant, 'google_service_account_key');
      let allowedServiceAccountEmail: string | undefined;

      if (serviceAccountKey) {
        try {
          const parsed = JSON.parse(serviceAccountKey);
          if (parsed?.client_email && typeof parsed.client_email === 'string') {
            allowedServiceAccountEmail = parsed.client_email;
          }
        } catch {
          // Ignore parse errors; we can still fall back to project_id-based suffix check below
        }
      }

      await verifyGoogleToken(token, webhookUrl, {
        allowedServiceAccountEmail,
        allowedProjectId: googleConfig.project_id,
      });
      console.log('✅ JWT token verified successfully');
    } catch (error) {
      console.error('❌ JWT verification failed:', error);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const enqueueResult = await enqueueUnifiedInboundEmailQueueJob({
        tenantId: provider.tenant,
        providerId: provider.id,
        provider: 'google',
        pointer: {
          historyId: notification.historyId,
          emailAddress: notification.emailAddress,
          pubsubMessageId: payloadData.messageId,
        },
      });
      console.log('✅ Enqueued unified inbound email pointer job (Google)', {
        providerId: provider.id,
        tenantId: provider.tenant,
        historyId: notification.historyId,
        emailAddress: notification.emailAddress,
        pubsubMessageId: payloadData.messageId,
        queueDepth: enqueueResult.queueDepth,
        jobId: enqueueResult.job.jobId,
      });
      return NextResponse.json({
        success: true,
        queued: true,
        handoff: 'unified_pointer_queue',
        providerId: provider.id,
        tenant: provider.tenant,
        historyId: notification.historyId,
        jobId: enqueueResult.job.jobId,
        queueDepth: enqueueResult.queueDepth,
      });
    } catch (enqueueError: any) {
      console.error('❌ Failed to enqueue Google pointer job', {
        providerId: provider.id,
        tenantId: provider.tenant,
        historyId: notification.historyId,
        pubsubMessageId: payloadData.messageId,
        error: enqueueError?.message || String(enqueueError),
      });
      return NextResponse.json(
        { error: 'Failed to enqueue Google pointer job' },
        { status: 503 }
      );
    }

  } catch (error: any) {
    const retryable = isRetryableWebhookError(error);
    console.error('❌ Google webhook handler error:', {
      error: error.message,
      stack: error.stack,
      messageId: payloadData?.messageId || 'unknown',
      subscription: payloadData?.subscription || 'unknown',
      retryable,
    });
    // Retry transient/unknown failures; acknowledge only likely permanent parse/validation failures.
    return NextResponse.json({ 
      success: false,
      error: error.message,
      retryable,
    }, {
      status: retryable ? 503 : 400,
    });
  }
}

// Verify Google JWT token
async function verifyGoogleToken(
  token: string,
  expectedAudience: string,
  opts: { allowedServiceAccountEmail?: string; allowedProjectId?: string } = {}
): Promise<void> {
  const client = new OAuth2Client();
  
  try {
    // First decode the token to see what audience it has
    const decodedToken = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    console.log('🔍 JWT token payload:', {
      audience: decodedToken.aud,
      issuer: decodedToken.iss,
      subject: decodedToken.sub,
      email: decodedToken.email
    });
    
    // Verify the token with the expected audience (do NOT trust the token's own aud)
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
    
    const payload = await ticket.getPayload();
    
    const email = payload?.email;
    const allowedExact = new Set(
      [opts.allowedServiceAccountEmail, 'pubsub-publishing@system.gserviceaccount.com'].filter(Boolean) as string[]
    );
    const allowedSuffix =
      opts.allowedProjectId && typeof opts.allowedProjectId === 'string'
        ? `@${opts.allowedProjectId}.iam.gserviceaccount.com`
        : undefined;

    const isAllowed =
      !!email &&
      (allowedExact.has(email) || (allowedSuffix ? email.endsWith(allowedSuffix) : false));

    if (!isAllowed) {
      throw new Error(
        `Invalid token issuer: ${email || 'unknown'} (allowed=${
          Array.from(allowedExact).join(',') || 'none'
        }${allowedSuffix ? ` suffix=${allowedSuffix}` : ''})`
      );
    }

    console.log('🔐 JWT token verified successfully:', {
      issuer: payload?.email,
      audience: payload?.aud,
      subject: payload?.sub,
      expectedAudience: expectedAudience
    });
  } catch (error) {
    console.error('Token verification failed:', error);
    throw error;
  }
}
