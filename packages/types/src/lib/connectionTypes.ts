/**
 * Registry of remote-connection types an RMM provider can offer on an asset.
 *
 * Providers decide which types exist (adapters return whatever their API
 * publishes, normalized); core code only decides how each type is presented.
 * The set is therefore open: `RmmRemoteConnectionType` accepts any string, and
 * the entries below only add presentation metadata (label, icon, order) for the
 * types we recognise. Unrecognised types are passed through and rendered with a
 * generic presentation.
 *
 * The OpenAPI description of `GET /api/v1/assets/{id}/rmm/remote-control`
 * (`server/src/lib/api/openapi/routes/assets.ts`) reads its known ids from this
 * tuple; regenerate the OpenAPI and chat/MCP registries (`npm run
 * generate:openapi && npm run mcp:registry:generate`) after changing it.
 */

export type RmmConnectionIcon = 'monitor' | 'terminal';

export interface RmmKnownConnectionTypeEntry {
  readonly id: string;
  /** i18n key in the `msp/assets` namespace. */
  readonly labelKey: string;
  readonly icon: RmmConnectionIcon;
  /** Display order in menus; lower first. */
  readonly order: number;
  /** Other spellings providers use, already in normalized form. */
  readonly aliases: readonly string[];
}

export const RMM_KNOWN_CONNECTION_TYPES = [
  { id: 'splashtop', labelKey: 'remoteAccess.remoteDesktop', icon: 'monitor', order: 10, aliases: [] },
  { id: 'teamviewer', labelKey: 'remoteAccess.connectionTypes.teamviewer', icon: 'monitor', order: 20, aliases: [] },
  { id: 'vnc', labelKey: 'remoteAccess.connectionTypes.vnc', icon: 'monitor', order: 30, aliases: [] },
  { id: 'rdp', labelKey: 'remoteAccess.connectionTypes.rdp', icon: 'monitor', order: 40, aliases: [] },
  { id: 'shell', labelKey: 'remoteAccess.remoteShell', icon: 'terminal', order: 50, aliases: [] },
  {
    id: 'ninjaone_remote',
    labelKey: 'remoteAccess.connectionTypes.ninjaoneRemote',
    icon: 'monitor',
    order: 60,
    aliases: ['ninjaone', 'ninjaoneremote'],
  },
] as const satisfies readonly RmmKnownConnectionTypeEntry[];

export type KnownRmmRemoteConnectionType = (typeof RMM_KNOWN_CONNECTION_TYPES)[number]['id'];

/** Any provider-supplied type; known ids keep editor completion. */
export type RmmRemoteConnectionType = KnownRmmRemoteConnectionType | (string & {});

export const RMM_GENERIC_CONNECTION_LABEL_KEY = 'remoteAccess.connectionTypes.generic';

const UNKNOWN_TYPE_ORDER = 1000;
const MAX_TYPE_LENGTH = 64;

const ALIAS_TO_ID: ReadonlyMap<string, KnownRmmRemoteConnectionType> = new Map(
  RMM_KNOWN_CONNECTION_TYPES.flatMap((entry) =>
    (entry.aliases as readonly string[]).map((alias) => [alias, entry.id] as const),
  ),
);

const KNOWN_BY_ID: ReadonlyMap<string, RmmKnownConnectionTypeEntry> = new Map(
  RMM_KNOWN_CONNECTION_TYPES.map((entry) => [entry.id, entry as RmmKnownConnectionTypeEntry]),
);

/** Lower-case, trim, collapse whitespace/dashes to `_`, then apply the alias table. Unknown values pass through. */
export function normalizeRmmConnectionType(raw: string): RmmRemoteConnectionType {
  const normalized = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ALIAS_TO_ID.get(normalized) ?? normalized;
}

export interface RmmConnectionTypeDescription {
  /** i18n key (msp/assets) when we have one; unknown types use the generic key only when unreadable. */
  labelKey?: string;
  /** Human-readable name, used for unknown types and as the i18n default. */
  fallbackLabel: string;
  icon: RmmConnectionIcon;
  order: number;
}

function humanize(id: string): string {
  if (!/[a-z]/.test(id)) return '';
  const words = id.split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Presentation for any type id, known or not, so callers never switch on the union. */
export function describeRmmConnectionType(id: RmmRemoteConnectionType): RmmConnectionTypeDescription {
  const normalized = normalizeRmmConnectionType(id);
  const known = KNOWN_BY_ID.get(normalized);
  if (known) {
    return { labelKey: known.labelKey, fallbackLabel: humanize(known.id), icon: known.icon, order: known.order };
  }
  const readable = humanize(normalized);
  return {
    labelKey: readable ? undefined : RMM_GENERIC_CONNECTION_LABEL_KEY,
    fallbackLabel: readable,
    icon: 'monitor',
    order: UNKNOWN_TYPE_ORDER,
  };
}

/** Boundary validator for untrusted input (query strings). Returns the normalized id, or null. */
export function parseRmmConnectionType(raw: unknown): RmmRemoteConnectionType | null {
  if (typeof raw !== 'string') return null;
  const normalized = normalizeRmmConnectionType(raw);
  if (!normalized || normalized.length > MAX_TYPE_LENGTH) return null;
  return /^[a-z0-9][a-z0-9_]*$/.test(normalized) ? normalized : null;
}

/** Display order hints for providers whose adapters publish a fixed set; types not listed sort after them. */
const PROVIDER_CONNECTION_ORDER: Readonly<Record<string, readonly KnownRmmRemoteConnectionType[]>> = {
  tacticalrmm: ['splashtop', 'shell'], // Tactical's `control` URL is its desktop session.
  datto: ['splashtop'], // Datto Web Remote, shown as Remote Desktop.
};

/**
 * Per-provider display order hint, never a gate: the adapter already returns
 * only the types the device publishes. Empty means "registry order".
 */
export function rmmConnectionTypesForProvider(provider: string | null | undefined): readonly RmmRemoteConnectionType[] {
  return (provider && PROVIDER_CONNECTION_ORDER[provider]) || [];
}

/** De-duplicate and order the types an adapter reported: provider hint first, then registry order, then provider order. */
export function orderRmmConnectionTypes(
  provider: string | null | undefined,
  reported: readonly RmmRemoteConnectionType[],
): RmmRemoteConnectionType[] {
  const hint = rmmConnectionTypesForProvider(provider);
  const rank = (type: RmmRemoteConnectionType) => {
    const index = hint.indexOf(type);
    return index >= 0 ? index : hint.length;
  };
  // Array.prototype.sort is stable, so equal ranks keep the provider's order.
  return [...new Set(reported)].sort((a, b) =>
    rank(a) - rank(b) || describeRmmConnectionType(a).order - describeRmmConnectionType(b).order);
}

/** Schemes that run code or read local data in the browser instead of opening a remote session. */
const UNSAFE_SESSION_URL_SCHEMES: ReadonlySet<string> = new Set(['javascript', 'vbscript', 'data', 'file', 'blob']);

/**
 * True when a provider-supplied session URL may be handed to the browser.
 * Only genuinely unsafe schemes are refused; https and provider app-launch
 * schemes (whatever a remote tool registers) pass. Browsers ignore ASCII
 * whitespace and control characters inside a scheme, so they are stripped
 * before the check.
 */
export function isSafeRemoteSessionUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  // eslint-disable-next-line no-control-regex
  const compact = url.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (!compact) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  return !scheme || !UNSAFE_SESSION_URL_SCHEMES.has(scheme);
}
