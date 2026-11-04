import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import { ControlError } from '@alga-psa/emulator-host';
import {
  HTTP_CONTENT_TYPES,
  HTTP_METHODS,
  LEVEL_EVENT_TYPES,
  LEVEL_SEVERITIES,
  LevelWireError,
} from './core';
import type { HttpRequestAction, LevelEmulatorCore, LevelEventType, LevelWebhookEndpoint } from './core';
import {
  deliverEvent,
  flushDueRetries,
  onAlertActive,
  onAlertResolved,
  rerunDelivery,
  runAutomation,
} from './dispatcher';

/**
 * Control inputs are typed from the core methods they feed rather than from
 * the zod schemas. A consumer that compiles this package without
 * strictNullChecks (EE's tsc includes its tests, which import the emulator
 * source) sees every z.infer key as optional, which no longer satisfies the
 * core signatures.
 */
// LEVERAGE: friction ee-tsc-compiles-foreign-package-sources-nonstrict — ee/server/tsconfig.json (strict:false) type-checks emulator src through package `types`, so zod inference cannot be the control signature.
type GroupSeedInput = Parameters<LevelEmulatorCore['createGroup']>[0];
type UpdateSeedInput = Parameters<LevelEmulatorCore['createUpdate']>[0];
type FireAlertInput = Parameters<LevelEmulatorCore['raiseAlert']>[0];
type WebhookSeedInput = Parameters<LevelEmulatorCore['registerWebhook']>[0];
type AutomationSeedInput = Omit<Parameters<LevelEmulatorCore['createAutomation']>[0], 'action'> &
  Partial<HttpRequestAction> & { url: string };

function mask(value: string | null): string | null {
  if (!value) return value;
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function maskedWebhook(webhook: LevelWebhookEndpoint) {
  return { ...webhook, secret: mask(webhook.secret) };
}

/** Core errors surface as control errors with the same status. */
async function control<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof LevelWireError) throw new ControlError(error.status, error.message);
    throw error;
  }
}

const EventTypes = z.array(z.enum(LEVEL_EVENT_TYPES));
const Severity = z.enum(LEVEL_SEVERITIES);

/**
 * Header rows as `[{key, value}]` (the Level UI's shape) or a plain object.
 */
const Headers = z
  .union([z.array(z.object({ key: z.string(), value: z.string() })), z.record(z.string(), z.string())])
  .transform((headers) => (Array.isArray(headers) ? headers : Object.entries(headers).map(([key, value]) => ({ key, value }))));

const DevicePatch = z
  .object({
    hostname: z.string().optional(),
    nickname: z.string().nullable().optional(),
    groupId: z.string().nullable().optional(),
    online: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    publicIpAddress: z.string().nullable().optional(),
    restartRequired: z.boolean().optional(),
  })
  .passthrough();

/** Accepts camel `groupId` alongside any vendor-named device field. */
function deviceFields(input: Record<string, unknown>) {
  const { groupId, ...rest } = input;
  return groupId === undefined ? rest : { ...rest, group_id: groupId };
}

export function register(reg: ControlRegistry, core: LevelEmulatorCore): void {
  const emit = async (eventType: LevelEventType, data: object) => {
    const event = core.emitEvent(eventType, data);
    return { event, deliveries: await deliverEvent(core, event) };
  };

  // ── Configuration and credentials ──────────────────────────────────────

  reg.action({
    name: 'configure',
    description: 'Set API keys and the webhook retry policy (max retries, base delay, jitter, background retry pump)',
    params: z.object({
      apiKeys: z.array(z.string().min(1)).optional(),
      webhookMaxRetries: z.number().int().min(0).max(10).optional(),
      retryBaseDelayMs: z.number().int().min(0).optional(),
      retryJitterMs: z.number().int().min(0).optional(),
      autoRetry: z.boolean().optional(),
    }),
    run: (patch) => {
      const config = core.configure(patch);
      return { ...config, apiKeys: config.apiKeys.map(mask) };
    },
  });

  reg.seeder({
    name: 'api-key',
    description: 'Accept another API key in the Authorization header (Settings → API)',
    params: z.object({ key: z.string().min(1) }),
    run: ({ key }) => {
      if (!core.config.apiKeys.includes(key)) core.config.apiKeys.push(key);
      return { apiKeys: core.config.apiKeys.map(mask) };
    },
  });

  reg.action({
    name: 'revoke-api-key',
    description: 'Stop accepting an API key; requests with it answer 401 Access denied',
    params: z.object({ key: z.string() }),
    run: ({ key }) => {
      core.config.apiKeys = core.config.apiKeys.filter((k) => k !== key);
      return { apiKeys: core.config.apiKeys.map(mask) };
    },
  });

  // ── Groups ─────────────────────────────────────────────────────────────

  reg.seeder({
    name: 'group',
    description: 'Create a group (optionally under a parent); emits group_created',
    params: z.object({ id: z.string().optional(), name: z.string(), parentId: z.string().nullable().optional() }),
    run: (input: GroupSeedInput) =>
      control(async () => {
        const group = core.createGroup(input);
        return { group: core.presentGroup(group), ...(await emit('group_created', core.presentGroup(group))) };
      }),
  });

  reg.action({
    name: 'update-group',
    description: 'Rename or re-parent a group; emits group_updated',
    params: z.object({ groupId: z.string(), name: z.string().optional(), parentId: z.string().nullable().optional() }),
    run: ({ groupId, ...patch }) =>
      control(async () => {
        const group = core.updateGroup(groupId, patch);
        return { group: core.presentGroup(group), ...(await emit('group_updated', core.presentGroup(group))) };
      }),
  });

  reg.action({
    name: 'delete-group',
    description: 'Delete a group (children move to its parent, devices become ungrouped); emits group_deleted',
    params: z.object({ groupId: z.string() }),
    run: ({ groupId }) =>
      control(async () => {
        const group = core.deleteGroup(groupId);
        return { group, ...(await emit('group_deleted', group)) };
      }),
  });

  // ── Devices ────────────────────────────────────────────────────────────

  reg.seeder({
    name: 'device',
    description:
      'Create a device (hostname, groupId, plus any Level device field: platform, serial_number, operating_system, network_interfaces, security …); emits device_created',
    params: DevicePatch.extend({ id: z.string().optional(), hostname: z.string() }),
    run: (input) =>
      control(async () => {
        const device = core.createDevice(deviceFields(input) as Parameters<LevelEmulatorCore['createDevice']>[0]);
        return { device: core.presentDevice(device, null), ...(await emit('device_created', core.presentDevice(device, null))) };
      }),
  });

  reg.action({
    name: 'update-device',
    description: 'Patch a device (any Level device field, groupId, publicIpAddress, restartRequired); emits device_updated',
    params: z.object({ deviceId: z.string(), patch: DevicePatch }),
    run: ({ deviceId, patch }) =>
      control(async () => {
        const device = core.updateDevice(deviceId, deviceFields(patch));
        return { device: core.presentDevice(device, null), ...(await emit('device_updated', core.presentDevice(device, null))) };
      }),
  });

  reg.action({
    name: 'delete-device',
    description: 'Remove a device; emits device_deleted',
    params: z.object({ deviceId: z.string() }),
    run: ({ deviceId }) =>
      control(async () => {
        const device = core.deleteDevice(deviceId);
        return { device, ...(await emit('device_deleted', { ...device })) };
      }),
  });

  reg.action({
    name: 'device-checkin',
    description: 'The agent reports in: device online, last_seen_at = now (no webhook)',
    params: z.object({ deviceId: z.string() }),
    run: ({ deviceId }) => control(() => core.presentDevice(core.checkIn(deviceId), null)),
  });

  reg.action({
    name: 'device-offline',
    description: 'The agent stops reporting: device offline, last_seen_at frozen at now (no webhook)',
    params: z.object({ deviceId: z.string() }),
    run: ({ deviceId }) => control(() => core.presentDevice(core.goOffline(deviceId), null)),
  });

  reg.seeder({
    name: 'update',
    description: 'Create an OS/software update record for a device (served by /v2/updates)',
    params: z
      .object({
        deviceId: z.string(),
        name: z.string(),
        category: z.string().optional(),
        is_available: z.boolean().optional(),
        installed_on: z.string().nullable().optional(),
      })
      .passthrough(),
    run: (input: UpdateSeedInput) => control(() => core.createUpdate(input)),
  });

  // ── Alerts ─────────────────────────────────────────────────────────────

  reg.action({
    name: 'fire-alert',
    description:
      'A monitor raises an alert on a device: the alert becomes active, alert_active goes to native webhooks, and matching monitor automations run their HTTP Request action. webhookDataExtra merges unverified fields into the webhook data.',
    params: z.object({
      deviceId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      payload: z.string().nullable().optional(),
      severity: Severity.optional(),
      id: z.string().optional(),
      webhookDataExtra: z.record(z.string(), z.unknown()).optional(),
    }),
    run: (input: FireAlertInput) => control(async () => onAlertActive(core, core.raiseAlert(input))),
  });

  reg.action({
    name: 'resolve-alert',
    description: 'Resolve an active alert (as Level does when the monitor clears); emits alert_resolved',
    params: z.object({ alertId: z.string() }),
    run: ({ alertId }) =>
      control(async () => {
        const { alert, changed } = core.resolveAlert(alertId);
        if (!changed) return { alert, event: null, deliveries: [] };
        return onAlertResolved(core, alert);
      }),
  });

  // ── Native webhooks ────────────────────────────────────────────────────

  reg.seeder({
    name: 'webhook',
    description:
      'Register a native webhook (Settings → Webhooks): URL, optional secret (adds X-Level-Signature), selected event types (default all). No custom headers.',
    params: z.object({
      id: z.string().optional(),
      url: z.string().url(),
      secret: z.string().nullable().optional(),
      eventTypes: EventTypes.optional(),
      enabled: z.boolean().optional(),
    }),
    run: (input: WebhookSeedInput) => maskedWebhook(core.registerWebhook(input)),
  });

  reg.action({
    name: 'update-webhook',
    description: 'Change a webhook endpoint: URL, secret (null clears it), event types, enabled',
    params: z.object({
      webhookId: z.string(),
      url: z.string().url().optional(),
      secret: z.string().nullable().optional(),
      eventTypes: EventTypes.optional(),
      enabled: z.boolean().optional(),
    }),
    run: ({ webhookId, ...patch }) =>
      control(() => {
        const webhook = core.getWebhook(webhookId);
        if (patch.url !== undefined) webhook.url = patch.url;
        if (patch.secret !== undefined) webhook.secret = patch.secret || null;
        if (patch.eventTypes !== undefined) webhook.eventTypes = [...patch.eventTypes];
        if (patch.enabled !== undefined) webhook.enabled = patch.enabled;
        return maskedWebhook(webhook);
      }),
  });

  reg.action({
    name: 'delete-webhook',
    description: 'Remove a webhook endpoint (its pending retries are dropped)',
    params: z.object({ webhookId: z.string() }),
    run: ({ webhookId }) =>
      control(() => {
        core.getWebhook(webhookId);
        core.webhooks.delete(webhookId);
        core.pendingRetries = core.pendingRetries.filter((r) => r.webhookId !== webhookId);
        return { deleted: webhookId };
      }),
  });

  reg.action({
    name: 'rerun-delivery',
    description: 'The request log\'s "Re-run request": resend a recorded delivery with the same event_id and body',
    params: z.object({ deliveryId: z.number().int() }),
    run: ({ deliveryId }) =>
      control(async () => {
        if (!core.deliveries.some((d) => d.id === deliveryId)) throw new ControlError(404, `Unknown delivery ${deliveryId}`);
        return rerunDelivery(core, deliveryId);
      }),
  });

  reg.action({
    name: 'deliver-due-retries',
    description: 'Deliver every automatic retry due at the current virtual time now (after `clock advance`)',
    run: () => flushDueRetries(core),
  });

  // ── Automations ────────────────────────────────────────────────────────

  reg.seeder({
    name: 'automation',
    description:
      'A monitor automation with an HTTP Request action. url/headers/body render {{level_*}} system variables and {{variables}}; unknown {{tokens}} are sent literally.',
    params: z.object({
      id: z.string().optional(),
      name: z.string(),
      enabled: z.boolean().optional(),
      alertNames: z.array(z.string()).optional(),
      groupIds: z.array(z.string()).optional(),
      url: z.string(),
      method: z.enum(HTTP_METHODS).optional(),
      contentType: z.enum(HTTP_CONTENT_TYPES).optional(),
      headers: Headers.optional(),
      body: z.string().optional(),
      variables: z.record(z.string(), z.string()).optional(),
      retries: z.number().int().min(0).max(5).optional(),
    }),
    run: ({ url, method, contentType, headers, body, ...rest }: AutomationSeedInput) =>
      core.createAutomation({
        ...rest,
        action: {
          url,
          ...(method ? { method } : {}),
          ...(contentType ? { contentType } : {}),
          ...(headers ? { headers } : {}),
          ...(body !== undefined ? { body } : {}),
        },
      }),
  });

  reg.action({
    name: 'run-automation',
    description: 'Run an automation on a device by hand (no alert context)',
    params: z.object({ automationId: z.string(), deviceId: z.string() }),
    run: ({ automationId, deviceId }) =>
      control(async () => {
        core.getDevice(deviceId);
        return runAutomation(core, core.getAutomation(automationId), { deviceId, alert: null });
      }),
  });

  // ── Faults ─────────────────────────────────────────────────────────────

  reg.fault({
    name: 'operation-fault',
    description:
      'Fail one REST operation ("GET /v2/devices", "GET /v2/groups", "GET /v2/devices/:id", "GET /v2/alerts", "POST /v2/alerts/:id/resolve", "GET /v2/updates", or "*") N times with a status and Level error envelope',
    params: z.object({
      operation: z.string(),
      status: z.number().int().min(400).max(599).default(500),
      message: z.string().default('Internal server error'),
      retryAfterSeconds: z.number().int().min(0).nullable().optional(),
      remaining: z.number().int().positive().default(1),
    }),
    arm: ({ operation, status, message, retryAfterSeconds, remaining }) =>
      core.armOperationFault({
        operation,
        status: status ?? 500,
        message: message ?? 'Internal server error',
        retryAfterSeconds: retryAfterSeconds ?? null,
        remaining: remaining ?? 1,
      }),
    disarm: () => core.disarmOperationFaults(),
  });

  reg.fault({
    name: 'rate-limit',
    description: 'Answer the next N REST requests with 429 and Retry-After (Level\'s rate-limit envelope is undocumented)',
    params: z.object({
      remaining: z.number().int().positive().default(1),
      retryAfterSeconds: z.number().int().min(0).default(1),
    }),
    arm: ({ remaining, retryAfterSeconds }) =>
      core.armOperationFault({
        operation: '*',
        status: 429,
        message: 'Too many requests',
        retryAfterSeconds: retryAfterSeconds ?? 1,
        remaining: remaining ?? 1,
      }),
    disarm: () => core.disarmOperationFaults(),
  });

  // ── State views ────────────────────────────────────────────────────────

  reg.stateView({
    name: 'config',
    description: 'API keys (masked) and webhook retry policy',
    get: () => ({ ...core.config, apiKeys: core.config.apiKeys.map(mask) }),
  });
  reg.stateView({
    name: 'groups',
    description: 'Groups as /v2/groups presents them (child_ids, device counts)',
    get: () => [...core.groups.values()].map((g) => core.presentGroup(g)),
  });
  reg.stateView({
    name: 'devices',
    description: 'Devices with every detail section',
    get: () => [...core.devices.values()].map((d) => core.presentDevice(d, null)),
  });
  reg.stateView({ name: 'alerts', description: 'Alerts, active and resolved', get: () => [...core.alerts.values()] });
  reg.stateView({ name: 'updates', description: 'Update records', get: () => [...core.updates.values()] });
  reg.stateView({
    name: 'webhooks',
    description: 'Native webhook endpoints (secrets masked)',
    get: () => [...core.webhooks.values()].map(maskedWebhook),
  });
  reg.stateView({ name: 'events', description: 'Emitted webhook events (envelopes as sent)', get: () => [...core.events.values()] });
  reg.stateView({
    name: 'webhook-deliveries',
    description: 'Every webhook send: trigger (initial/retry/rerun), attempt, signature, status, response',
    get: () => core.deliveries,
  });
  reg.stateView({
    name: 'pending-retries',
    description: 'Automatic retries waiting for their backoff to elapse',
    get: () => core.pendingRetries.map((r) => ({ ...r, dueAt: new Date(r.dueAtMs).toISOString() })),
  });
  reg.stateView({ name: 'automations', description: 'Monitor automations and their HTTP Request actions', get: () => [...core.automations.values()] });
  reg.stateView({
    name: 'automation-runs',
    description: 'Rendered HTTP Request action sends, with unresolved {{tokens}} and the response',
    get: () => core.automationRuns,
  });
  reg.stateView({ name: 'operation-faults', description: 'Armed REST faults', get: () => core.operationFaults });
}
