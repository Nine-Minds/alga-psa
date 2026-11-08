// Client-component-safe: no server imports. The settings UI shows these.

export const DATTO_RMM_WEBHOOK_PATH = '/api/webhooks/datto';

/**
 * Payload templates for a Datto RMM monitor's webhook response
 * (Monitors > monitor > Response > Webhook). Datto substitutes `[variable]`
 * placeholders when it sends the request; see
 * https://rmm.datto.com/help/en/Content/3NEWUI/Monitors/Webhooks.htm
 *
 * `[alert_message]` is intentionally absent: Datto inserts it unescaped, so a
 * quote or line break in the text would produce invalid JSON. The webhook route
 * reads the full diagnostics from the Datto API using `alertUid` instead.
 */
function buildTemplate(event: 'trigger' | 'resolve'): string {
  return JSON.stringify(
    {
      event,
      alertUid: '[alert_uid]',
      deviceUid: '[device_uid]',
      siteUid: '[site_uid]',
      hostname: '[device_hostname]',
      alertType: '[alert_type]',
    },
    null,
    2
  );
}

/** Body for the "alert triggered" webhook payload. */
export function buildDattoWebhookBodyTemplate(): string {
  return buildTemplate('trigger');
}

/** Body for the optional "alert resolved" webhook payload. */
export function buildDattoWebhookResolveBodyTemplate(): string {
  return buildTemplate('resolve');
}
