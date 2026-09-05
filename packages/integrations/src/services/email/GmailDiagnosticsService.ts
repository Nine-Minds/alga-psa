/**
 * Gmail inbound delivery diagnostics.
 *
 * Answers one question for an administrator: is mail actually going to arrive?
 * Every step checks live Google state against the values this instance derives
 * from {@link ../../utils/email/gmailPubSub}, so an audience or endpoint that
 * drifted shows up as a mismatch with both sides printed rather than as a
 * provider card that just says "connected".
 */

import { google } from 'googleapis';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import type {
  DiagnosticsStepStatus,
  GmailDiagnosticsReport,
  GmailDiagnosticsStep,
} from '@alga-psa/shared/interfaces/gmail-diagnostics.interfaces';
import {
  GMAIL_PUBLISHER_ROLE,
  GMAIL_PUSH_SERVICE_ACCOUNT,
  buildGmailWebhookUrl,
  gmailSubscriptionName,
  gmailTopicName,
  requireGmailWebhookBaseUrl,
} from '../../utils/email/gmailPubSub';

const WATCH_WARNING_WINDOW_MS = 24 * 60 * 60 * 1000;
const PUSH_STALENESS_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export interface GmailDiagnosticsInput {
  tenant: string;
  provider: {
    id: string;
    mailbox: string;
  };
  googleConfig: {
    project_id?: string | null;
    pubsub_topic_name?: string | null;
    pubsub_subscription_name?: string | null;
    watch_expiration?: string | Date | null;
    last_push_received_at?: string | Date | null;
  } | null;
}

interface StepRecorder {
  steps: GmailDiagnosticsStep[];
  run<T>(
    id: string,
    title: string,
    fn: () => Promise<{ status: DiagnosticsStepStatus; data?: Record<string, unknown>; remediation?: string; value?: T }>,
    onError: (error: any) => { remediation: string; status?: DiagnosticsStepStatus }
  ): Promise<T | undefined>;
}

function createRecorder(): StepRecorder {
  const steps: GmailDiagnosticsStep[] = [];

  return {
    steps,
    async run(id, title, fn, onError) {
      const startedAt = new Date();
      try {
        const outcome = await fn();
        steps.push({
          id,
          title,
          status: outcome.status,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          remediation: outcome.remediation,
          data: outcome.data,
        });
        return outcome.value;
      } catch (error: any) {
        const handled = onError(error);
        steps.push({
          id,
          title,
          status: handled.status ?? 'fail',
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          remediation: handled.remediation,
          error: {
            message: error?.message ? String(error.message) : String(error),
            code: error?.code !== undefined ? String(error.code) : undefined,
            status: typeof error?.status === 'number' ? error.status : undefined,
          },
        });
        return undefined;
      }
    },
  };
}

function toIso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function worstStatus(steps: GmailDiagnosticsStep[]): DiagnosticsStepStatus {
  if (steps.some((s) => s.status === 'fail')) return 'fail';
  if (steps.some((s) => s.status === 'warn')) return 'warn';
  if (steps.every((s) => s.status === 'skip')) return 'skip';
  return 'pass';
}

/**
 * Run the full delivery checklist for one Gmail provider.
 */
export async function runGmailDeliveryDiagnostics(
  input: GmailDiagnosticsInput
): Promise<GmailDiagnosticsReport> {
  const { tenant, provider, googleConfig } = input;
  const recorder = createRecorder();
  const now = Date.now();

  const projectId = googleConfig?.project_id || undefined;
  const topicName = googleConfig?.pubsub_topic_name || gmailTopicName(tenant);
  const subscriptionName = googleConfig?.pubsub_subscription_name || gmailSubscriptionName(tenant);
  const watchExpiration = toIso(googleConfig?.watch_expiration);
  const lastPushReceivedAt = toIso(googleConfig?.last_push_received_at);

  let expectedWebhookUrl: string | undefined;
  let actualPushEndpoint: string | undefined;
  let actualAudience: string | undefined;

  // 1. Public base URL — the value every other check is measured against.
  await recorder.run<string>(
    'base-url',
    'Public base URL for push delivery',
    async () => {
      const resolved = await requireGmailWebhookBaseUrl();
      expectedWebhookUrl = buildGmailWebhookUrl(resolved.baseUrl);
      return {
        status: 'pass' as const,
        data: {
          baseUrl: resolved.baseUrl,
          source: resolved.source,
          expectedWebhookUrl,
        },
        value: resolved.baseUrl,
      };
    },
    () => ({
      remediation:
        'Set NEXT_PUBLIC_BASE_URL (or NGROK_URL for local development) to the public HTTPS address of this Alga instance, then run Refresh Pub/Sub & Watch. Google will not deliver to an address it cannot reach.',
    })
  );

  // 2. Service account credentials.
  const credentials = await recorder.run<Record<string, any>>(
    'service-account',
    'Google service account credentials',
    async () => {
      const secretProvider = await getSecretProviderInstance();
      const raw = await secretProvider.getTenantSecret(tenant, 'google_service_account_key');
      if (!raw) {
        throw new Error('No google_service_account_key is stored for this tenant.');
      }
      const parsed = JSON.parse(raw);
      return {
        status: 'pass' as const,
        data: { clientEmail: parsed.client_email, projectId: parsed.project_id },
        value: parsed,
      };
    },
    () => ({
      remediation:
        'Upload a valid Google service account key (JSON) for this tenant in the Google integration settings. The key must belong to the same Google Cloud project as the Pub/Sub topic.',
    })
  );

  const canQueryGoogle = Boolean(credentials && projectId);

  let pubsub: ReturnType<typeof google.pubsub> | null = null;
  if (canQueryGoogle) {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: credentials as any,
        scopes: ['https://www.googleapis.com/auth/pubsub', 'https://www.googleapis.com/auth/cloud-platform'],
      });
      pubsub = google.pubsub({ version: 'v1', auth: (await auth.getClient()) as any });
    } catch {
      pubsub = null;
    }
  }

  const topicPath = projectId ? `projects/${projectId}/topics/${topicName}` : undefined;
  const subscriptionPath = projectId ? `projects/${projectId}/subscriptions/${subscriptionName}` : undefined;

  const skipGoogleStep = (title: string, id: string) =>
    recorder.run(
      id,
      title,
      async () => ({
        status: 'skip' as const,
        remediation: projectId
          ? 'Could not authenticate to Google Cloud with the stored service account key; fix that first.'
          : 'No Google Cloud project ID is configured for this provider. Set it in the Google integration settings.',
      }),
      () => ({ remediation: 'Google Cloud could not be queried.' })
    );

  // 3. Topic exists.
  if (pubsub && topicPath) {
    await recorder.run(
      'topic',
      'Pub/Sub topic exists',
      async () => {
        const response = await pubsub!.projects.topics.get({ topic: topicPath });
        return { status: 'pass' as const, data: { topic: response.data.name || topicPath } };
      },
      (error) => ({
        remediation:
          error?.code === 404
            ? `Topic ${topicPath} does not exist. Run Refresh Pub/Sub & Watch to create it, or create it manually in Google Cloud.`
            : `Could not read topic ${topicPath}. Grant the service account roles/pubsub.viewer (or roles/pubsub.admin) on the project.`,
      })
    );

    // 4. Publisher binding for Gmail's own service account.
    await recorder.run(
      'topic-iam',
      'Gmail may publish to the topic',
      async () => {
        const response = await pubsub!.projects.topics.getIamPolicy({ resource: topicPath } as any);
        const bindings = Array.isArray(response.data.bindings) ? response.data.bindings : [];
        const member = `serviceAccount:${GMAIL_PUSH_SERVICE_ACCOUNT}`;
        const granted = bindings.some(
          (b: any) => b.role === GMAIL_PUBLISHER_ROLE && Array.isArray(b.members) && b.members.includes(member)
        );

        return {
          status: (granted ? 'pass' : 'fail') as DiagnosticsStepStatus,
          data: { role: GMAIL_PUBLISHER_ROLE, member, granted },
          remediation: granted
            ? undefined
            : `Grant ${GMAIL_PUBLISHER_ROLE} to ${GMAIL_PUSH_SERVICE_ACCOUNT} on ${topicPath}. Without it Gmail's watch call is rejected and nothing is ever published.`,
        };
      },
      () => ({
        remediation: `Could not read the IAM policy of ${topicPath}. The service account needs pubsub.topics.getIamPolicy (roles/pubsub.admin covers it).`,
      })
    );

    // 5. Subscription push endpoint and OIDC audience.
    await recorder.run(
      'subscription',
      'Push subscription targets this instance',
      async () => {
        const response = await pubsub!.projects.subscriptions.get({ subscription: subscriptionPath! });
        actualPushEndpoint = response.data.pushConfig?.pushEndpoint || undefined;
        actualAudience = response.data.pushConfig?.oidcToken?.audience || undefined;

        const data: Record<string, unknown> = {
          subscription: response.data.name || subscriptionPath,
          topic: response.data.topic,
          expectedWebhookUrl,
          actualPushEndpoint: actualPushEndpoint ?? null,
          actualAudience: actualAudience ?? null,
          serviceAccountEmail: response.data.pushConfig?.oidcToken?.serviceAccountEmail ?? null,
        };

        if (!expectedWebhookUrl) {
          return {
            status: 'warn' as const,
            data,
            remediation:
              'The subscription exists, but this instance has no usable public base URL to compare it against. Fix the base URL check above first.',
          };
        }

        const endpointMatches = actualPushEndpoint === expectedWebhookUrl;
        const audienceMatches = actualAudience === expectedWebhookUrl;

        if (endpointMatches && audienceMatches) {
          return { status: 'pass' as const, data };
        }

        const mismatches: string[] = [];
        if (!endpointMatches) {
          mismatches.push(`push endpoint is ${actualPushEndpoint || '(none)'} but should be ${expectedWebhookUrl}`);
        }
        if (!audienceMatches) {
          mismatches.push(`OIDC audience is ${actualAudience || '(none)'} but should be ${expectedWebhookUrl}`);
        }

        return {
          status: 'fail' as const,
          data,
          remediation:
            `The subscription ${mismatches.join(', and the ')}. Every push signed with the wrong audience is rejected with 401 and the message is dropped. ` +
            'Run Refresh Pub/Sub & Watch to rewrite the push configuration, or correct the base URL this instance is configured with.',
        };
      },
      (error) => ({
        remediation:
          error?.code === 404
            ? `Subscription ${subscriptionPath} does not exist, so Google has nowhere to deliver. Run Refresh Pub/Sub & Watch to create it.`
            : `Could not read subscription ${subscriptionPath}. Grant the service account roles/pubsub.viewer on the project.`,
      })
    );
  } else {
    await skipGoogleStep('Pub/Sub topic exists', 'topic');
    await skipGoogleStep('Gmail may publish to the topic', 'topic-iam');
    await skipGoogleStep('Push subscription targets this instance', 'subscription');
  }

  // 6. Gmail watch registration. Gmail has no "read my watch" API, so the
  // expiration recorded when the watch was registered is the only evidence.
  await recorder.run(
    'watch',
    'Gmail watch is registered and current',
    async () => {
      if (!watchExpiration) {
        return {
          status: 'fail' as const,
          data: { watchExpiration: null },
          remediation:
            'No Gmail watch has been registered for this mailbox, so Gmail publishes nothing. Run Refresh Pub/Sub & Watch.',
        };
      }

      const expiresAt = new Date(watchExpiration).getTime();
      const remainingMs = expiresAt - now;
      const data = {
        watchExpiration,
        remainingHours: Math.round(remainingMs / (60 * 60 * 1000)),
      };

      if (remainingMs <= 0) {
        return {
          status: 'fail' as const,
          data,
          remediation:
            'The Gmail watch has expired, so Gmail has stopped publishing notifications for this mailbox. Run Refresh Pub/Sub & Watch. Gmail watches last seven days and are renewed automatically only on Enterprise Edition, so Community Edition needs this refresh weekly.',
        };
      }

      if (remainingMs < WATCH_WARNING_WINDOW_MS) {
        return {
          status: 'warn' as const,
          data,
          remediation:
            'The Gmail watch expires within a day. Run Refresh Pub/Sub & Watch before it lapses — once expired, Gmail silently stops publishing.',
        };
      }

      return { status: 'pass' as const, data };
    },
    () => ({ remediation: 'The stored watch expiration could not be read. Run Refresh Pub/Sub & Watch.' })
  );

  // 7. Evidence that pushes are actually landing.
  await recorder.run(
    'push-delivery',
    'Push notifications are arriving',
    async () => {
      if (!lastPushReceivedAt) {
        return {
          status: 'warn' as const,
          data: { lastPushReceivedAt: null },
          remediation:
            'This instance has never accepted a push for this mailbox. That is expected on a mailbox that has received no mail since setup; otherwise it points at the subscription or audience checks above.',
        };
      }

      const ageMs = now - new Date(lastPushReceivedAt).getTime();
      const data = { lastPushReceivedAt, ageHours: Math.round(ageMs / (60 * 60 * 1000)) };

      if (ageMs > PUSH_STALENESS_WARNING_MS) {
        return {
          status: 'warn' as const,
          data,
          remediation:
            'No push has arrived in over a week. On a mailbox that receives mail regularly this usually means the watch lapsed or the subscription now points somewhere else.',
        };
      }

      return { status: 'pass' as const, data };
    },
    () => ({ remediation: 'The last push timestamp could not be read.' })
  );

  const steps = recorder.steps;
  const recommendations = steps
    .filter((step) => step.status === 'fail' || step.status === 'warn')
    .map((step) => step.remediation)
    .filter((r): r is string => Boolean(r));

  return {
    createdAt: new Date().toISOString(),
    summary: {
      providerId: provider.id,
      tenantId: tenant,
      providerType: 'google',
      mailbox: provider.mailbox,
      projectId,
      topicName,
      subscriptionName,
      expectedWebhookUrl,
      actualPushEndpoint,
      actualAudience,
      watchExpiration,
      lastPushReceivedAt,
      overallStatus: worstStatus(steps),
    },
    steps,
    recommendations,
    supportBundle: {
      providerId: provider.id,
      tenant,
      mailbox: provider.mailbox,
      projectId,
      topicPath,
      subscriptionPath,
      expectedWebhookUrl,
      actualPushEndpoint,
      actualAudience,
      watchExpiration,
      lastPushReceivedAt,
      steps: steps.map(({ id, status, durationMs, data, error }) => ({ id, status, durationMs, data, error })),
    },
  };
}
