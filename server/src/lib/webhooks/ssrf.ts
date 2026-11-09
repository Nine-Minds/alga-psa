import {
  assertSafeOutboundTarget,
  UnsafeOutboundTargetError,
} from '@alga-psa/shared/lib/net/outboundTarget';

export class UnsafeWebhookTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebhookTargetError';
  }
}

/** Preserve the webhook API and error class while delegating policy to shared. */
export async function assertSafeWebhookTarget(targetUrl: string): Promise<void> {
  try {
    await assertSafeOutboundTarget(targetUrl, {
      schemes: ['http', 'https'],
      allowPrivateTargets: process.env.WEBHOOK_SSRF_ALLOW_PRIVATE === 'true',
    });
  } catch (error) {
    if (error instanceof UnsafeOutboundTargetError) {
      throw new UnsafeWebhookTargetError(error.message.replace(/^Outbound target/, 'Webhook target'));
    }
    throw error;
  }
}
