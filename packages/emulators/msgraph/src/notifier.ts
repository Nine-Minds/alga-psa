import type { HostEnv } from '@alga-psa/emulator-host';
import { signBotFrameworkJwt } from './botFramework';
import type { GraphMessage, GraphSubscription, InboundBotActivityInput, MsGraphCore } from './core';

/**
 * Webhook I/O lives here, outside the pure core: Graph's subscription
 * validation handshake and change-notification delivery.
 */
export async function validateNotificationUrl(notificationUrl: string, validationToken: string): Promise<boolean> {
  const url = new URL(notificationUrl);
  url.searchParams.set('validationToken', validationToken);
  try {
    const response = await fetch(url, { method: 'POST' });
    return response.ok && (await response.text()) === validationToken;
  } catch {
    return false;
  }
}

export async function deliverNotifications(core: MsGraphCore, message: GraphMessage, env: HostEnv): Promise<void> {
  await Promise.all(
    core.activeSubscriptions().map((subscription) => deliverOne(subscription, message, env)),
  );
}

async function deliverOne(subscription: GraphSubscription, message: GraphMessage, env: HostEnv): Promise<void> {
  try {
    await fetch(subscription.notificationUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [
          {
            subscriptionId: subscription.id,
            clientState: subscription.clientState,
            changeType: 'created',
            resource: `${subscription.resource}/${message.id}`,
            resourceData: { id: message.id },
          },
        ],
      }),
    });
  } catch (error) {
    env.log('msgraph notification delivery failed', {
      subscriptionId: subscription.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface InboundBotActivityResult {
  targetUrl: string;
  delivered: boolean;
  /** Status the app's bot endpoint answered with, or null when unreachable. */
  status: number | null;
  /** The app's synchronous reply body, so callers see the bot's answer inline. */
  response?: unknown;
  error?: string;
  activity: Record<string, unknown>;
}

/**
 * Inbound injection: build a Bot Framework Activity, sign it with the
 * emulator's Bot Framework key, and POST it at the app's bot endpoint the way
 * Microsoft would. The app verifies the signature against the emulator's JWKS,
 * so the real inbound-security path is exercised end to end.
 */
export async function deliverInboundBotActivity(
  core: MsGraphCore,
  input: InboundBotActivityInput,
  env: HostEnv,
): Promise<InboundBotActivityResult> {
  const { activity, targetUrl, serviceUrl, audience, aadObjectId, tenantId } = core.buildInboundActivity(input);
  const token = signBotFrameworkJwt(
    { aud: audience, serviceurl: serviceUrl, oid: aadObjectId, tid: tenantId },
    Math.floor(env.clock.now().getTime() / 1000),
  );

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(activity),
    });
    const raw = await response.text();
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      /* non-JSON bodies pass through as text */
    }
    return { targetUrl, delivered: true, status: response.status, response: parsed, activity };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    env.log('msgraph inbound bot activity delivery failed', { targetUrl, error: message });
    return { targetUrl, delivered: false, status: null, error: message, activity };
  }
}
