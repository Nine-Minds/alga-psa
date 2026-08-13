import type { HostEnv } from '@alga-psa/emulator-host';
import { signBotFrameworkJwt } from './botFramework';
import type {
  GraphMeetingArtifact,
  GraphMessage,
  GraphSubscription,
  InboundBotActivityInput,
  MsGraphCore,
} from './core';

const ARTIFACT_SUBSCRIPTION_RESOURCES = {
  recording: 'communications/onlineMeetings/getAllRecordings',
  transcript: 'communications/onlineMeetings/getAllTranscripts',
} as const;

/**
 * Webhook I/O lives here, outside the pure core: Graph's subscription
 * validation handshake and change-notification delivery.
 *
 * Real Graph never follows redirects on either call, so both use
 * `redirect: 'manual'`. Node's default of following them would let a
 * redirecting notificationUrl pass here and fail in production.
 */
export async function validateNotificationUrl(notificationUrl: string, validationToken: string): Promise<boolean> {
  const url = new URL(notificationUrl);
  url.searchParams.set('validationToken', validationToken);
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'manual' });
    return response.ok && (await response.text()) === validationToken;
  } catch {
    return false;
  }
}

export async function deliverNotifications(core: MsGraphCore, message: GraphMessage, env: HostEnv): Promise<void> {
  // Mail notifications must not reach meeting-artifact subscriptions: real Graph
  // scopes change notifications to the subscribed resource.
  const artifactResources = new Set<string>(Object.values(ARTIFACT_SUBSCRIPTION_RESOURCES));
  await Promise.all(
    core.activeSubscriptions()
      .filter((subscription) => !artifactResources.has(subscription.resource))
      .map((subscription) => deliverOne(subscription, message, env)),
  );
}

export interface ArtifactNotificationDelivery {
  subscriptionId: string;
  notificationUrl: string;
  delivered: boolean;
  status: number | null;
  error?: string;
}

/**
 * Push a Graph change notification for a new recording/transcript at every live
 * getAllRecordings/getAllTranscripts subscription, the way real Graph notifies
 * the app's /api/teams/webhooks/recordings endpoint. The resource string uses
 * the onlineMeetings('{id}')/kind('{id}') shape the app's parser expects.
 */
export async function deliverMeetingArtifactNotifications(
  core: MsGraphCore,
  artifact: GraphMeetingArtifact,
  env: HostEnv,
): Promise<ArtifactNotificationDelivery[]> {
  const resource = ARTIFACT_SUBSCRIPTION_RESOURCES[artifact.kind];
  const kindSegment = artifact.kind === 'recording' ? 'recordings' : 'transcripts';
  const subscriptions = core.activeSubscriptions().filter((subscription) => subscription.resource === resource);

  return Promise.all(subscriptions.map(async (subscription): Promise<ArtifactNotificationDelivery> => {
    const body = {
      value: [
        {
          subscriptionId: subscription.id,
          clientState: subscription.clientState,
          changeType: 'created',
          resource: `communications/onlineMeetings('${artifact.meetingId}')/${kindSegment}('${artifact.id}')`,
          resourceData: {
            id: artifact.id,
            '@odata.id': `communications/onlineMeetings('${artifact.meetingId}')/${kindSegment}('${artifact.id}')`,
          },
        },
      ],
    };
    try {
      const response = await fetch(subscription.notificationUrl, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return {
        subscriptionId: subscription.id,
        notificationUrl: subscription.notificationUrl,
        delivered: response.ok,
        status: response.status,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      env.log('msgraph artifact notification delivery failed', {
        subscriptionId: subscription.id,
        error: message,
      });
      return {
        subscriptionId: subscription.id,
        notificationUrl: subscription.notificationUrl,
        delivered: false,
        status: null,
        error: message,
      };
    }
  }));
}

async function deliverOne(subscription: GraphSubscription, message: GraphMessage, env: HostEnv): Promise<void> {
  try {
    await fetch(subscription.notificationUrl, {
      method: 'POST',
      redirect: 'manual',
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
  // The token is stamped with wall time, not env.clock: its iat/nbf/exp are
  // consumed by the app's jose verifier, which reads the real clock with zero
  // tolerance — and real Microsoft stamps wall time too. Emulator STATE (access
  // token expiry, subscriptions, activity timestamps) still flows through
  // env.clock, so `clock advance` and activity injection compose. Backdate
  // deliberately with tokenAgeSeconds to test an expired inbound token.
  const issuedAt = Math.floor(Date.now() / 1000) - (input.tokenAgeSeconds ?? 0);
  const token = signBotFrameworkJwt(
    { aud: audience, serviceurl: serviceUrl, oid: aadObjectId, tid: tenantId },
    issuedAt,
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
