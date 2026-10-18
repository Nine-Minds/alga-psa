/**
 * Pure helpers for the Level.io webhook route: authentication primitives,
 * placeholder rejection and automation-path alert identity.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** Level system variables that were not rendered look like `{{alert_id}}`. */
const PLACEHOLDER = /\{\{[^}]*\}\}/;

/**
 * Normalizes an automation payload value. Anything that still contains an
 * unrendered `{{...}}` token (Level sends unknown variables literally) is
 * treated as absent - it must never become an alert id, device id, name or
 * condition.
 */
export function cleanAutomationValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text || PLACEHOLDER.test(text)) return null;
  return text;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, so guard it. Length itself is
  // not secret for a fixed-size hex digest / generated secret.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Constant-time comparison for the `X-Alga-Webhook-Secret` header. */
export function secretsMatch(provided: string, expected: string): boolean {
  return safeEqual(provided, expected);
}

/**
 * Verifies Level's `X-Level-Signature: sha256=<hex>` over the exact raw body
 * bytes (parse JSON only after this succeeds).
 */
export function verifyLevelSignature(rawBody: string, header: string | null, signingSecret: string): boolean {
  if (!header) return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!match) return false;
  const expected = createHmac('sha256', signingSecret).update(rawBody, 'utf8').digest();
  const provided = Buffer.from(match[1], 'hex');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * The literal `name` in the generated automation payload template. Left
 * unedited it would give every automation on a device the same identity, so
 * the webhook falls back to a payload-derived name (see parseAutomationPayload).
 */
export const LEVELIO_AUTOMATION_NAME_PLACEHOLDER = 'Replace with a name for this alert';
export const LEVELIO_AUTOMATION_DESCRIPTION_PLACEHOLDER = 'Replace with a description';

/**
 * Automation alert identity.
 *
 * Level exposes no alert variables to automations, so there is no alert id to
 * forward. Identity is derived deterministically from the device plus the
 * alert name the customer typed into the automation's payload:
 * `automation:<deviceId>:<name>`. Distinct alerts (different device or name)
 * no longer collapse; a repeat of the same alert on the same device maps to
 * the same row. While that row is open (`active`/`acknowledged`/`suppressed`),
 * another firing of the same name on the same device dedupes into it, and two
 * automations that share a name on one device are the same alert. When the
 * row's ticket closes, the ticket-closed subscriber resets the row to
 * `resolved` through the Level outbound adapter (no remote call is made for
 * `automation:` ids), so the next firing reopens it and creates a new ticket. A
 * customer-supplied `alert_id` (rendered, not a placeholder) still takes precedence.
 */
export function automationAlertId(deviceId: string, name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const id = `automation:${deviceId}:${normalized}`;
  if (id.length <= 255) return id;
  return `automation:${deviceId}:${createHash('sha256').update(normalized).digest('hex')}`.slice(0, 255);
}
