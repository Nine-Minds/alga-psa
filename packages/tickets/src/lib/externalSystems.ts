import {
  BUILT_IN_EXTERNAL_SYSTEM_KEY_PATTERN,
  BUILT_IN_EXTERNAL_SYSTEMS,
  CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN,
  type ExternalSystemDefinition,
  type IExternalEntityLink,
  type ITenantExternalSystem,
  type TicketOriginDisplay,
} from '@alga-psa/types';

/**
 * External system registry resolution and URL rendering.
 *
 * Built-in systems are declared in @alga-psa/types; tenants may add their own
 * `custom:<slug>` systems (URL template optional). Kept free of DB access so it
 * is usable from server actions, the REST layer, and the UI. See
 * docs/plans/2026-09-13-ticket-external-system-link-plan.md §1.
 */

export function isBuiltInExternalSystemKey(key: string): boolean {
  return BUILT_IN_EXTERNAL_SYSTEM_KEY_PATTERN.test(key) && !key.startsWith('custom:');
}

export function isCustomExternalSystemKey(key: string): boolean {
  return CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN.test(key);
}

export function findBuiltInExternalSystem(key: string): ExternalSystemDefinition | null {
  return BUILT_IN_EXTERNAL_SYSTEMS.find((entry) => entry.key === key) ?? null;
}

function isValidCustomKey(key: string): boolean {
  return CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN.test(key)
    && !BUILT_IN_EXTERNAL_SYSTEMS.some((entry) => entry.key === key);
}

export function customExternalSystemToDefinition(
  row: Pick<ITenantExternalSystem, 'key' | 'label' | 'url_template'>,
): ExternalSystemDefinition | null {
  if (!isValidCustomKey(row.key)) {
    return null;
  }
  return {
    key: row.key,
    label: row.label,
    icon: 'Link',
    urlTemplate: row.url_template ?? undefined,
    originCategory: 'other',
  };
}

export function resolveExternalSystem(
  tenantSystems: readonly ITenantExternalSystem[] | null | undefined,
  key: string,
): ExternalSystemDefinition | null {
  const builtIn = findBuiltInExternalSystem(key);
  if (builtIn) {
    return builtIn;
  }
  const custom = tenantSystems?.find((row) => row.key === key);
  return custom ? customExternalSystemToDefinition(custom) : null;
}

export function listExternalSystems(
  tenantSystems: readonly ITenantExternalSystem[] | null | undefined,
): ExternalSystemDefinition[] {
  const customs = (tenantSystems ?? [])
    .map(customExternalSystemToDefinition)
    .filter((entry): entry is ExternalSystemDefinition => entry !== null);
  return [...BUILT_IN_EXTERNAL_SYSTEMS, ...customs];
}

/** Only http(s) URLs are accepted; anything else (javascript:, data:, …) is rejected. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isValidExternalUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return safeExternalUrl(value) !== null;
}

/**
 * Resolves the link-out href, preferring an explicit link.url over the system's
 * template. Returns null when no safe URL can be produced (e.g. a realm-bearing
 * template with no realm, or a system that declares no template).
 */
export function renderExternalLinkUrl(
  definition: ExternalSystemDefinition | null,
  link: Pick<IExternalEntityLink, 'external_id' | 'realm' | 'url'>,
): string | null {
  const explicit = safeExternalUrl(link.url);
  if (explicit) {
    return explicit;
  }
  const template = definition?.urlTemplate;
  if (!template) {
    return null;
  }
  const needsRealm = template.includes('{realm}');
  const realm = link.realm?.trim();
  if (needsRealm && !realm) {
    return null;
  }
  const href = template
    .replaceAll('{realm}', encodeRealmForUrl(realm ?? ''))
    .replaceAll('{external_id}', encodeURIComponent(link.external_id));
  return safeExternalUrl(href);
}

/**
 * Realm values may be path-shaped (GitHub `owner/repo`). Encode each path
 * segment so `/` survives while other reserved characters are escaped.
 */
function encodeRealmForUrl(realm: string): string {
  return realm
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function resolveExternalSystemOrigin(
  tenantSystems: readonly ITenantExternalSystem[] | null | undefined,
  key: string | null | undefined,
): TicketOriginDisplay | null {
  if (!key) {
    return null;
  }
  return resolveExternalSystem(tenantSystems, key)?.originCategory ?? null;
}
