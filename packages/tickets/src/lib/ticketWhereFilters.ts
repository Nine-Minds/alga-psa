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
  | { locations: 'ticket' | 'contact' };

export interface WhereFilterDescriptor {
  /** Path in the ticket query schema. */
  path: 'contact.tags' | 'client.tags' | 'location_id' | 'contact.locations';
  options: WhereFilterOptionsSource;
  labelKey: string;
  defaultLabel: string;
}

export const WHERE_FILTERS: readonly WhereFilterDescriptor[] = [
  { path: 'contact.tags', options: { tags: 'contact' }, labelKey: 'filters.requesterTags', defaultLabel: 'Requester tags' },
  { path: 'client.tags', options: { tags: 'client' }, labelKey: 'filters.clientTags', defaultLabel: 'Client tags' },
  { path: 'location_id', options: { locations: 'ticket' }, labelKey: 'filters.location', defaultLabel: 'Location' },
  { path: 'contact.locations', options: { locations: 'contact' }, labelKey: 'filters.requesterLocation', defaultLabel: 'Requester location' },
];

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
 * text (a tag's text, a location's name); an unknown id falls back to the id itself so the chip can
 * still be cleared.
 */
export function whereFilterChips(
  where: PredicateGroup | undefined,
  valueLabel: (descriptor: WhereFilterDescriptor, valueId: string) => string | undefined,
  labelFor: (descriptor: WhereFilterDescriptor) => string,
  descriptors: readonly WhereFilterDescriptor[] = WHERE_FILTERS,
): WhereFilterChip[] {
  const chips: WhereFilterChip[] = [];
  for (const descriptor of descriptors) {
    const selection = getWhereTagSelection(where, descriptor.path);
    if (!selection) continue;
    const label = labelFor(descriptor);
    for (const tagId of selection.ids) {
      const text = valueLabel(descriptor, tagId) ?? tagId;
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
