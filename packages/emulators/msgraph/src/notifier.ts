import type { HostEnv } from '@alga-psa/emulator-host';
import type { GraphMessage, GraphSubscription, MsGraphCore } from './core';

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
