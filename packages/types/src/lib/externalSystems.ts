import {
  BUILT_IN_EXTERNAL_SYSTEM_KEY_PATTERN,
  BUILT_IN_EXTERNAL_SYSTEMS,
  CUSTOM_EXTERNAL_SYSTEM_KEY_PATTERN,
  type ExternalSystemDefinition,
  type IExternalEntityLink,
  type ITenantExternalSystem,
} from '../interfaces/externalSystem.interfaces';
import type { TicketOriginDisplay } from '../interfaces/ticket.interfaces';

/** Shared external-system registry resolution and safe URL rendering. */
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
  if (!isValidCustomKey(row.key)) return null;
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
  if (builtIn) return builtIn;
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

/** Only http(s) URLs are accepted; anything else is rejected. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isValidExternalUrl(value: unknown): boolean {
  return typeof value === 'string' && safeExternalUrl(value) !== null;
}

export function renderExternalLinkUrl(
  definition: ExternalSystemDefinition | null,
  link: Pick<IExternalEntityLink, 'external_id' | 'realm' | 'url'>,
): string | null {
  const explicit = safeExternalUrl(link.url);
  if (explicit) return explicit;
  const template = definition?.urlTemplate;
  if (!template) return null;
  const realm = link.realm?.trim();
  if (template.includes('{realm}') && !realm) return null;
  const href = template
    .replaceAll('{realm}', encodeRealmForUrl(realm ?? ''))
    .replaceAll('{external_id}', encodeURIComponent(link.external_id));
  return safeExternalUrl(href);
}

function encodeRealmForUrl(realm: string): string {
  return realm.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

export function resolveExternalSystemOrigin(
  tenantSystems: readonly ITenantExternalSystem[] | null | undefined,
  key: string | null | undefined,
): TicketOriginDisplay | null {
  if (!key) return null;
  return resolveExternalSystem(tenantSystems, key)?.originCategory ?? null;
}
