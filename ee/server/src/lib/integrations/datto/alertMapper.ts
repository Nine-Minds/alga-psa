import { createHash } from 'node:crypto';

import type { NormalizedRmmAlertEvent, NormalizedRmmAlertSeverity } from '@alga-psa/shared/rmm/alerts';
import type { DattoAlert } from './types';

/** Longest message handed to the pipeline (rmm_alerts.message / ticket text). */
const MAX_MESSAGE_LENGTH = 2000;
/** Longest single context value rendered into the message. */
const MAX_CONTEXT_VALUE_LENGTH = 200;
/** rmm_alerts dedup keys are capped at 255 chars; leave room for the device id. */
const MAX_CONDITION_IDENTITY_LENGTH = 160;

/**
 * alertContext keys that distinguish one firing condition from another of the
 * same class on a device (which disk, which process, which event source ...).
 * Keys that change on every sample (sample, freeSpace, roundtripTime ...) are
 * deliberately absent: they would defeat dedup.
 */
const CONDITION_CONTEXT_KEYS = [
  'type',
  'diskName',
  'processName',
  'logName',
  'source',
  'code',
  'path',
  'objectType',
  'productName',
  'packageName',
  'patchUid',
  'policyUid',
  'displayName',
  'monitorName',
  'monitorInstance',
  'ruleName',
  'OID',
  'oid',
  'instanceName',
  'ipAddress',
  'esAlertId',
] as const;

/**
 * Classes where one device legitimately has a single firing condition, so the
 * class alone is the right identity. Every other class with no identifying
 * context gets a discriminator (see buildConditionIdentity); class-only there
 * would fold unrelated alerts (two different scripts, two threats) into one
 * ticket.
 */
const CLASS_ONLY_IDENTITY_CLASSES = new Set(['onlineofflinestatus']);

/**
 * Maps a Datto RMM alert (GET /v2/alert/{uid} or an entry of the open-alerts
 * list) onto the provider-agnostic event the shared pipeline consumes. Returns
 * null when the alert has no uid, since nothing can be correlated without it.
 *
 * Datto alerts carry no stable "condition" id of their own: alertMonitorInfo
 * only exposes notification flags in the v2 spec. The dedup identity is the
 * context class plus the context fields that name the monitored object, plus
 * any uid-like monitor fields a live account happens to return. Classes with
 * nothing to name the object (script, WMI, performance, security threats ...)
 * fall back to a hash of the diagnostics' first line, then to the alert uid, so
 * unrelated alerts of one class never collapse into one ticket. Every source
 * (poller, webhook, webhook payload fallback) maps through here.
 */
export function mapDattoAlertToEvent(
  alert: DattoAlert | null | undefined,
  tenantId: string,
  integrationId: string
): NormalizedRmmAlertEvent | null {
  const externalAlertId = alert?.alertUid != null ? String(alert.alertUid).trim() : '';
  if (!alert || !externalAlertId) return null;

  const source = alert.alertSourceInfo ?? {};
  const alertClass = shortAlertClass(alert.alertContext?.['@class']);

  return {
    tenantId,
    integrationId,
    provider: 'datto',
    kind: alert.resolved === true ? 'reset' : 'triggered',
    externalAlertId,
    externalDeviceId: cleanString(source.deviceUid),
    conditionIdentity: buildConditionIdentity(alert, alertClass),
    activityType: 'datto_alert',
    alertClass,
    sourceType: 'datto_alert',
    severity: mapDattoPriority(alert.priority),
    message: buildMessage(alert, alertClass),
    deviceName: cleanString(source.deviceName),
    externalOrganizationId: cleanString(source.siteUid),
    occurredAt: parseDattoTimestamp(alert.timestamp),
    raw: alert as unknown as Record<string, unknown>,
  };
}

export function mapDattoPriority(priority: unknown): NormalizedRmmAlertSeverity {
  switch (String(priority ?? '').trim().toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'major';
    case 'moderate':
      return 'moderate';
    case 'low':
      return 'minor';
    default:
      // Information, Unknown, or missing.
      return 'none';
  }
}

/**
 * Datto timestamps arrive as epoch milliseconds (number or numeric string);
 * tolerate epoch seconds and ISO strings, and fall back to now rather than let
 * an unparsable value reach the rmm_alerts timestamp column.
 */
export function parseDattoTimestamp(value: unknown): string {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{9,16}$/.test(value.trim()))) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      const ms = Math.abs(num) < 1e11 ? num * 1000 : num; // ≤ 10 digits → seconds
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  } else if (typeof value === 'string' && value.trim()) {
    const d = new Date(value.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/** 'com.centrastage.x.perf_disk_usage_ctx' -> 'perf_disk_usage_ctx'. */
function shortAlertClass(value: unknown): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  const short = raw.split(/[.$]/).filter(Boolean).pop();
  return short ?? raw;
}

function cleanString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** 'online_offline_status_ctx' / 'OnlineOfflineStatusContext' -> 'onlineofflinestatus'. */
function classKey(alertClass: string | null): string {
  return (alertClass ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(ctx|context)$/, '');
}

/**
 * Short stable hash of the first line of Datto's diagnostics with digits
 * stripped (timestamps, counters, exit codes, sample values), so repeats of the
 * same script/WMI/performance condition match while different ones do not.
 * Null when there are no diagnostics to hash.
 */
function diagnosticsDiscriminator(diagnostics: unknown): string | null {
  const firstLine = cleanString(diagnostics)?.split(/\r?\n/)[0] ?? '';
  const normalized = firstLine.toLowerCase().replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return createHash('sha1').update(normalized).digest('hex').slice(0, 10);
}

function buildConditionIdentity(alert: DattoAlert, alertClass: string | null): string | null {
  const parts: string[] = [];
  if (alertClass) parts.push(alertClass);

  const context = (alert.alertContext ?? {}) as Record<string, unknown>;
  for (const key of CONDITION_CONTEXT_KEYS) {
    const value = context[key];
    if (isScalar(value) && String(value).trim()) parts.push(`${key}=${String(value).trim()}`);
  }

  const monitor = (alert.alertMonitorInfo ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(monitor).sort()) {
    if (/(uid|id)$/i.test(key) && isScalar(monitor[key]) && String(monitor[key]).trim()) {
      parts.push(`monitor.${key}=${String(monitor[key]).trim()}`);
    }
  }

  // Nothing but the class (or nothing at all): for classes without a natural
  // single condition per device, tell alerts apart by what they say, or by
  // their own uid when they say nothing identifying. (A missing class would
  // otherwise fall through to the shared 'datto_alert' dedup bucket.)
  const hasIdentifyingPart = parts.length > (alertClass ? 1 : 0);
  let discriminator = '';
  if (!hasIdentifyingPart && !(alertClass && CLASS_ONLY_IDENTITY_CLASSES.has(classKey(alertClass)))) {
    const hash = diagnosticsDiscriminator(alert.diagnostics);
    discriminator = hash ? `diag=${hash}` : `alert=${cleanString(alert.alertUid) ?? ''}`;
  }

  const base = parts.join('|').slice(0, MAX_CONDITION_IDENTITY_LENGTH - (discriminator ? discriminator.length + 1 : 0));
  const identity = [base, discriminator].filter(Boolean).join('|');
  return identity || null;
}

function renderContextValue(value: unknown): string | null {
  if (isScalar(value)) {
    const text = String(value).trim();
    return text ? text.slice(0, MAX_CONTEXT_VALUE_LENGTH) : null;
  }
  if (Array.isArray(value)) {
    const items = value.filter(isScalar).map((v) => String(v).trim()).filter(Boolean);
    return items.length ? items.join(', ').slice(0, MAX_CONTEXT_VALUE_LENGTH) : null;
  }
  return null;
}

/** Human-readable text: Datto's diagnostics followed by the context details. */
function buildMessage(alert: DattoAlert, alertClass: string | null): string | null {
  const diagnostics = cleanString(alert.diagnostics);

  const details: string[] = [];
  const context = (alert.alertContext ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(context)) {
    if (key === '@class') continue;
    const rendered = renderContextValue(value);
    if (rendered) details.push(`${key}: ${rendered}`);
  }

  const pieces: string[] = [];
  if (diagnostics) pieces.push(diagnostics);
  if (details.length) pieces.push(details.join('; '));
  if (pieces.length === 0 && alertClass) pieces.push(`Datto RMM alert (${alertClass})`);
  if (pieces.length === 0) return null;

  return pieces.join('\n').slice(0, MAX_MESSAGE_LENGTH);
}
