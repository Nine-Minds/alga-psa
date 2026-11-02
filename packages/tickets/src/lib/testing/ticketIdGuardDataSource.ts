import { nativeTicketDataSource } from '../nativeTicketDataSource';
import {
  composeTicketDataSource,
  type TicketCapabilities,
  type TicketDataSource,
  type TicketDataSourceOverrides,
} from '../ticketDataSource';

/**
 * T003 harness. A data source whose native, ticket-id keyed methods all throw.
 * An app layer that backs the ticket screen with a different record (for
 * example a ticket shared across tenants) mounts the screen under this source,
 * layering its own overrides on top, and any code path that still reaches a
 * native ticket-id action fails loudly instead of silently reading or writing
 * the wrong tenant's data.
 *
 * Groups keyed by a native ticket id, plus `avatars` (keyed by the ticket's
 * tenant), are replaced. Pure configuration (`capabilities`, `screen`,
 * `conversation`, `slots`, `time`) and viewer/option helpers are kept from
 * the base.
 */
export const TICKET_ID_KEYED_GROUPS = [
  'ticket',
  'comments',
  'people',
  'resources',
  'watchers',
  'bundles',
  'checklist',
  'externalLinks',
  'activity',
  'email',
  'materials',
  'tiles',
  'tags',
  // Not ticket-id keyed, but keyed by the caller-supplied `ticket.tenant`:
  // a non-native source must supply tenant-safe avatar reads of its own.
  'avatars',
] as const;

export type TicketIdKeyedGroup = (typeof TICKET_ID_KEYED_GROUPS)[number];

export class NativeTicketIdMethodCalledError extends Error {
  constructor(public readonly group: string, public readonly method: string) {
    super(`Native ticket-id method ${group}.${method} was called on a data source that must not reach native ticket actions`);
    this.name = 'NativeTicketIdMethodCalledError';
  }
}

function throwingGroup(group: string, methods: object): object {
  return Object.fromEntries(
    Object.keys(methods).map((method) => [
      method,
      () => {
        throw new NativeTicketIdMethodCalledError(group, method);
      },
    ]),
  );
}

export interface TicketIdGuardOptions {
  /** Capabilities for the guarded source. Defaults to the base's. */
  capabilities?: TicketCapabilities;
  /** Per-group overrides applied on top of the throwing groups (the app layer's real methods). */
  overrides?: TicketDataSourceOverrides;
  /** Base to guard. Defaults to the native source. */
  base?: TicketDataSource;
}

export function createTicketIdGuardDataSource(options: TicketIdGuardOptions = {}): TicketDataSource {
  const base = options.base ?? nativeTicketDataSource;
  const guarded: Record<string, object> = {};
  for (const group of TICKET_ID_KEYED_GROUPS) {
    guarded[group] = throwingGroup(group, base[group] as object);
  }
  const guardedBase = composeTicketDataSource(base, guarded as unknown as TicketDataSourceOverrides);
  const withCaps = options.capabilities
    ? { ...guardedBase, capabilities: options.capabilities }
    : guardedBase;
  return options.overrides ? composeTicketDataSource(withCaps, options.overrides) : withCaps;
}
