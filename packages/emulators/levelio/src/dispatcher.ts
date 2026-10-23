import { createHmac } from 'node:crypto';
import type {
  AutomationRunRecord,
  DeliveryTrigger,
  LevelAlert,
  LevelAutomation,
  LevelEmulatorCore,
  LevelWebhookEndpoint,
  LevelWebhookEvent,
  WebhookDeliveryRecord,
} from './core';
import { renderTemplate, systemVariables } from './variables';

/** Level asks receivers to answer within 10 seconds. */
const DELIVERY_TIMEOUT_MS = 10_000;
const RESPONSE_EXCERPT = 500;

/** `sha256=<lowercase hex HMAC-SHA256 of the raw body>`, as X-Level-Signature carries it. */
export function signLevelPayload(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

interface HttpOutcome {
  status: number;
  ok: boolean;
  response: string;
  error?: string;
}

async function send(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<HttpOutcome> {
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      // A redirect is a failed delivery; the Location is not followed.
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    const response = (await res.text()).slice(0, RESPONSE_EXCERPT);
    return { status: res.status, ok: res.status >= 200 && res.status < 300, response };
  } catch (error) {
    return { status: 0, ok: false, response: '', error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Sends one event to one endpoint. Native webhooks carry only Level's own
 * headers: there is no way to add a custom header (so no X-Alga-Webhook-Secret),
 * and X-Level-Signature is present only when the endpoint has a secret.
 */
async function deliverTo(
  core: LevelEmulatorCore,
  webhook: LevelWebhookEndpoint,
  event: LevelWebhookEvent,
  trigger: DeliveryTrigger,
  attempt: number,
): Promise<WebhookDeliveryRecord> {
  const rawBody = core.serializeEvent(event);
  const signature = webhook.secret ? signLevelPayload(rawBody, webhook.secret) : null;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['x-level-signature'] = signature;
  const outcome = await send(webhook.url, { method: 'POST', headers, body: rawBody });
  const record = core.recordDelivery({
    webhookId: webhook.id,
    eventId: event.event_id,
    eventType: event.event_type,
    trigger,
    attempt,
    url: webhook.url,
    signature,
    ...outcome,
  });
  core.env.log('levelio webhook delivery', {
    webhookId: webhook.id,
    eventType: event.event_type,
    eventId: event.event_id,
    attempt,
    trigger,
    status: outcome.status,
  });
  return record;
}

/** First delivery of an event to every enabled endpoint subscribed to its type. */
export async function deliverEvent(core: LevelEmulatorCore, event: LevelWebhookEvent): Promise<WebhookDeliveryRecord[]> {
  const records: WebhookDeliveryRecord[] = [];
  for (const webhook of core.subscribers(event.event_type)) {
    records.push(await deliverTo(core, webhook, event, 'initial', 1));
  }
  return records;
}

/** "Re-run request": resend a recorded delivery's event — same event_id, same bytes. */
export async function rerunDelivery(core: LevelEmulatorCore, deliveryId: number): Promise<WebhookDeliveryRecord> {
  const original = core.deliveries.find((d) => d.id === deliveryId);
  if (!original) throw new Error(`Unknown delivery ${deliveryId}`);
  const event = core.events.get(original.eventId)!;
  const webhook = core.getWebhook(original.webhookId);
  return deliverTo(core, webhook, event, 'rerun', original.attempt);
}

/** Delivers every automatic retry due at the current virtual time. */
export async function flushDueRetries(core: LevelEmulatorCore): Promise<WebhookDeliveryRecord[]> {
  const records: WebhookDeliveryRecord[] = [];
  for (const retry of core.takeDueRetries(core.now().getTime())) {
    const event = core.events.get(retry.eventId);
    const webhook = core.webhooks.get(retry.webhookId);
    // A deleted or disabled endpoint, or a reset, drops the remaining retries.
    if (!event || !webhook || !webhook.enabled) continue;
    records.push(await deliverTo(core, webhook, event, 'retry', retry.attempt));
  }
  return records;
}

/**
 * Background retry pump: delivers due retries as wall or virtual time passes.
 * The timer is unref'd so it never holds a process open.
 */
export function startRetryPump(core: LevelEmulatorCore, intervalMs = 500): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running || !core.config.autoRetry || core.pendingRetries.length === 0) return;
    running = true;
    flushDueRetries(core)
      .catch((error) => core.env.log('levelio retry pump failed', { error: String(error) }))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * The automation HTTP Request action, rendered for a device: URL, header keys
 * and values, and body all go through variable rendering.
 */
export async function runAutomation(
  core: LevelEmulatorCore,
  automation: LevelAutomation,
  context: { deviceId: string; alert: LevelAlert | null },
): Promise<AutomationRunRecord[]> {
  const variables = { ...automation.variables, ...systemVariables(core, context.deviceId) };
  const unresolved = new Set<string>();
  const render = (template: string) => {
    const result = renderTemplate(template, variables);
    result.unresolved.forEach((name) => unresolved.add(name));
    return result.text;
  };

  const { action } = automation;
  const url = render(action.url);
  const headers: Record<string, string> = {};
  if (action.method !== 'GET') headers['content-type'] = action.contentType;
  for (const { key, value } of action.headers) {
    const name = render(key).trim();
    if (name) headers[name.toLowerCase()] = render(value);
  }
  const body = action.method === 'GET' ? '' : render(action.body);

  const runs: AutomationRunRecord[] = [];
  for (let attempt = 1; attempt <= 1 + automation.retries; attempt += 1) {
    const outcome = await send(url, {
      method: action.method,
      headers,
      body: action.method === 'GET' ? undefined : body,
    });
    const run = core.recordAutomationRun({
      automationId: automation.id,
      alertId: context.alert?.id ?? null,
      deviceId: context.deviceId,
      attempt,
      request: { method: action.method, url, headers, body },
      unresolvedVariables: [...unresolved],
      ...outcome,
    });
    core.env.log('levelio automation http request', {
      automationId: automation.id,
      attempt,
      status: outcome.status,
      unresolved: run.unresolvedVariables,
    });
    runs.push(run);
    if (outcome.ok) break;
  }
  return runs;
}

export interface AlertFiredResult {
  alert: LevelAlert;
  event: LevelWebhookEvent;
  deliveries: WebhookDeliveryRecord[];
  automationRuns: AutomationRunRecord[];
}

/**
 * An alert becoming active: emits alert_active to native webhooks, then runs
 * every monitor automation whose trigger matches (the remediation path).
 */
export async function onAlertActive(core: LevelEmulatorCore, alert: LevelAlert): Promise<AlertFiredResult> {
  const event = core.emitEvent('alert_active', core.alertEventData(alert));
  const deliveries = await deliverEvent(core, event);
  const automationRuns: AutomationRunRecord[] = [];
  for (const automation of core.automationsForAlert(alert)) {
    automationRuns.push(...(await runAutomation(core, automation, { deviceId: alert.device_id, alert })));
  }
  return { alert, event, deliveries, automationRuns };
}

export async function onAlertResolved(core: LevelEmulatorCore, alert: LevelAlert) {
  const event = core.emitEvent('alert_resolved', core.alertEventData(alert));
  return { alert, event, deliveries: await deliverEvent(core, event) };
}
