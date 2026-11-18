import type { PredicateClause, PredicateGroup } from '@alga-psa/predicates';
import { ticketWhereClauses } from './ticketWhere';

/**
 * Toolbar descriptors for filters that live only in `ITicketListFilters.where`. One row per filter:
 * the toolbar control, the active-filter chips and the chip's individual clear are all derived from
 * this table, so a new `where` filter is a new row (plus its options source), not new bespoke wiring.
 */
export type WhereTagMode = 'in' | 'not_in';

/**
 * Where the control gets its options. The two shapes are the only kinds of `where` filter so far,
 * and each one decides which toolbar control the dashboard renders for the row — which is the point
 * of keeping it in the table rather than in the component.
 */
export type WhereFilterOptionsSource =
  | { tags: 'contact' | 'client' }
  | { locations: 'ticket' | 'contact' }
  /** Clients, found by server-side search (never a loaded list) and named by an id lookup. */
  | { clients: 'search' };

/** Where in the toolbar the control sits: the primary row (after Board) or the secondary row. */
export type WhereFilterPlacement = 'primary' | 'secondary';

export interface WhereFilterDescriptor {
  /** Path in the ticket query schema. */
  path: 'contact.tags' | 'client.tags' | 'location_id' | 'contact.locations' | 'client.id';
  options: WhereFilterOptionsSource;
  labelKey: string;
  defaultLabel: string;
  placement: WhereFilterPlacement;
  /** Chip text for a selected id whose name does not resolve. Rows without one fall back to the id. */
  unknownValue?: { labelKey: string; defaultLabel: string };
}

export const WHERE_FILTERS: readonly WhereFilterDescriptor[] = [
  { path: 'contact.tags', options: { tags: 'contact' }, labelKey: 'filters.requesterTags', defaultLabel: 'Requester tags', placement: 'secondary' },
  { path: 'client.tags', options: { tags: 'client' }, labelKey: 'filters.clientTags', defaultLabel: 'Client tags', placement: 'secondary' },
  { path: 'location_id', options: { locations: 'ticket' }, labelKey: 'filters.location', defaultLabel: 'Location', placement: 'secondary' },
  { path: 'contact.locations', options: { locations: 'contact' }, labelKey: 'filters.requesterLocation', defaultLabel: 'Requester location', placement: 'secondary' },
  {
    path: 'client.id',
    options: { clients: 'search' },
    labelKey: 'fields.client',
    defaultLabel: 'Client',
    placement: 'primary',
    unknownValue: { labelKey: 'filters.unknownClient', defaultLabel: 'Unknown client' },
  },
];

/** The rows for one toolbar row, in table order. */
export const whereFiltersFor = (placement: WhereFilterPlacement): readonly WhereFilterDescriptor[] =>
  WHERE_FILTERS.filter((descriptor) => descriptor.placement === placement);

/** The tag rows, with the `taggedType` the tag control reads. Unchanged in content and order. */
export type WhereTagFilterDescriptor = WhereFilterDescriptor & {
  path: 'contact.tags' | 'client.tags';
  taggedType: 'contact' | 'client';
};

export const WHERE_TAG_FILTERS: readonly WhereTagFilterDescriptor[] = WHERE_FILTERS
  .filter((descriptor): descriptor is WhereFilterDescriptor & { options: { tags: 'contact' | 'client' } } =>
    'tags' in descriptor.options)
  .map((descriptor) => ({ ...descriptor, taggedType: descriptor.options.tags } as WhereTagFilterDescriptor));

/** The location rows, with the side of the join the control offers options from. */
export type WhereLocationFilterDescriptor = WhereFilterDescriptor & {
  path: 'location_id' | 'contact.locations';
  locationOf: 'ticket' | 'contact';
};

export const WHERE_LOCATION_FILTERS: readonly WhereLocationFilterDescriptor[] = WHERE_FILTERS
  .filter((descriptor): descriptor is WhereFilterDescriptor & { options: { locations: 'ticket' | 'contact' } } =>
    'locations' in descriptor.options)
  .map((descriptor) => ({ ...descriptor, locationOf: descriptor.options.locations } as WhereLocationFilterDescriptor));

/** The client row (path `client.id`), with the options source the toolbar control reads. */
export const WHERE_CLIENT_FILTER = WHERE_FILTERS.find((descriptor) => descriptor.path === 'client.id')!;

export interface WhereLocationOption {
  location_id: string;
  location_name: string;
  /** Prefixed to the label when the list spans clients, so two "Head office" rows are tellable apart. */
  client_name?: string | null;
}

/** How one location reads in a filter control: "Client · Location" when the list spans clients. */
export function locationFilterLabel(option: WhereLocationOption): string {
  return option.client_name ? `${option.client_name} · ${option.location_name}` : option.location_name;
}

export interface WhereTagSelection {
  mode: WhereTagMode;
  /** Tag definition ids, or location ids — whichever the path's value column holds. */
  ids: string[];
}

/** Reads as the general thing it has always been; the tag-named alias stays for existing callers. */
export type WhereSelection = WhereTagSelection;

const isTagClause = (clause: PredicateClause, path: string): boolean =>
  clause.path === path && (clause.operator === 'in' || clause.operator === 'not_in');

/** The current selection for a tag path, or null when the path has no (valid) clause. */
export function getWhereTagSelection(where: PredicateGroup | undefined, path: string): WhereTagSelection | null {
  const clause = ticketWhereClauses(where).find((c) => isTagClause(c, path));
  if (!clause || !Array.isArray(clause.value)) return null;
  const ids = clause.value.filter((v): v is string => typeof v === 'string');
  return ids.length > 0 ? { mode: clause.operator as WhereTagMode, ids } : null;
}

/**
 * Replaces the clause for `path` (any-of / none-of) and leaves every other clause untouched. An
 * empty selection removes the clause; an empty group becomes `undefined` so it leaves the URL.
 */
export function setWhereTagSelection(
  where: PredicateGroup | undefined,
  path: string,
  selection: WhereTagSelection | null,
): PredicateGroup | undefined {
  const others = ticketWhereClauses(where).filter((c) => !isTagClause(c, path));
  const next: PredicateClause[] =
    selection && selection.ids.length > 0
      ? [...others, { path, operator: selection.mode, value: [...new Set(selection.ids)] }]
      : others;
  return next.length > 0 ? { join: 'and', clauses: next } : undefined;
}

/**
 * The one client a row narrows the list to: "Any of" exactly one client. Contact and location
 * options are scoped to that client; any other selection leaves them tenant-wide.
 */
export function getSingleClientScope(where: PredicateGroup | undefined): string | null {
  const selection = getWhereTagSelection(where, 'client.id');
  return selection && selection.mode === 'in' && selection.ids.length === 1 ? selection.ids[0] : null;
}

/** Flips Any of / None of and keeps the ids. */
export function flipWhereMode(selection: WhereTagSelection): WhereTagSelection {
  return { mode: selection.mode === 'in' ? 'not_in' : 'in', ids: selection.ids };
}

export interface WhereFilterChip {
  key: string;
  path: string;
  mode: WhereTagMode;
  tagId: string;
  label: string;
  /** The `where` after clearing just this chip. */
  clear: () => PredicateGroup | undefined;
}

/**
 * One chip per selected value for each descriptor in the table. `valueLabel` resolves an id to its
 * text (a tag's text, a location's name); an unresolved id shows the descriptor's `unknownValue`
 * label (a client row never shows its id) or, for rows without one, the id itself, so the chip can
 * still be cleared. `unknownLabel` translates the descriptor's fallback.
 */
export function whereFilterChips(
  where: PredicateGroup | undefined,
  valueLabel: (descriptor: WhereFilterDescriptor, valueId: string) => string | undefined,
  labelFor: (descriptor: WhereFilterDescriptor) => string,
  descriptors: readonly WhereFilterDescriptor[] = WHERE_FILTERS,
  unknownLabel: (descriptor: WhereFilterDescriptor) => string | undefined = (descriptor) =>
    descriptor.unknownValue?.defaultLabel,
): WhereFilterChip[] {
  const chips: WhereFilterChip[] = [];
  for (const descriptor of descriptors) {
    const selection = getWhereTagSelection(where, descriptor.path);
    if (!selection) continue;
    const label = labelFor(descriptor);
    for (const tagId of selection.ids) {
      const text = valueLabel(descriptor, tagId) ?? unknownLabel(descriptor) ?? tagId;
      chips.push({
        key: `where:${descriptor.path}:${selection.mode}:${tagId}`,
        path: descriptor.path,
        mode: selection.mode,
        tagId,
        label: `${label} ${selection.mode === 'in' ? '=' : '≠'} ${text}`,
        clear: () =>
          setWhereTagSelection(where, descriptor.path, {
            mode: selection.mode,
            ids: selection.ids.filter((id) => id !== tagId),
          }),
      });
    }
  }
  return chips;
}

/**
 * The tag-only chip list, kept so existing callers read unchanged. It is the general function over
 * the tag rows, so the two tag descriptors behave exactly as they did before the generalisation.
 */
export function whereTagFilterChips(
  where: PredicateGroup | undefined,
  tagLabel: (descriptor: WhereTagFilterDescriptor, tagId: string) => string | undefined,
  labelFor: (descriptor: WhereTagFilterDescriptor) => string,
): WhereFilterChip[] {
  return whereFilterChips(
    where,
    (descriptor, valueId) => tagLabel(descriptor as WhereTagFilterDescriptor, valueId),
    (descriptor) => labelFor(descriptor as WhereTagFilterDescriptor),
    WHERE_TAG_FILTERS,
  );
}

/** Reads as the general thing it has always been; the tag-named aliases stay for existing callers. */
export const getWhereSelection = getWhereTagSelection;
export const setWhereSelection = setWhereTagSelection;
