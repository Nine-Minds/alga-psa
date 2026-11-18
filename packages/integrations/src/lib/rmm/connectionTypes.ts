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
 * `server/src/lib/api/openapi/routes/assets.ts` and the generated chat registry
 * (`ee/server/src/chat/registry/apiRegistry.generated.ts`) list the known ids;
 * keep them in step with this tuple.
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

const PROVIDER_CONNECTION_TYPES: Readonly<Record<string, readonly KnownRmmRemoteConnectionType[]>> = {
  tacticalrmm: ['splashtop', 'shell'], // Tactical's `control` URL is its desktop session.
  datto: ['splashtop'], // Datto Web Remote, shown as Remote Desktop.
};

/**
 * Per-provider hint. A provider that publishes a closed set returns that set in
 * display order; `null` means unconstrained, so every type the adapter returns
 * (including ones with no metadata) is offered in registry order.
 */
export function rmmConnectionTypesForProvider(provider: string | null | undefined): readonly RmmRemoteConnectionType[] | null {
  return (provider && PROVIDER_CONNECTION_TYPES[provider]) || null;
}
