import { allowedOperators, resolvePath, unicodeLowerV1 } from '@alga-psa/predicates';
import type { PredicateClause, PredicateGroup, PredicateOperator } from '@alga-psa/predicates';
import { ticketQuerySchema } from './ticketQuerySchema';
import { WHERE_TAG_FILTERS } from './ticketWhereFilters';

export interface TicketPredicateField {
  path: string;
  labelKey: string;
  defaultLabel: string;
  control: 'select' | 'multiselect' | 'tags' | 'text' | 'boolean' | 'client';
  operators: readonly PredicateOperator[];
  options?:
    | 'boards'
    | 'categories'
    | 'subcategories'
    | 'priorities'
    | 'origins'
    | 'definitions'
    | { tags: 'client' | 'contact' };
  fold?: 'lower';
  ownerSensitive?: boolean;
}

const field = (
  path: string,
  label: string,
  control: TicketPredicateField['control'],
  options?: TicketPredicateField['options']
): TicketPredicateField => ({
  path,
  labelKey: `ticketing.checklistTemplates.predicate.fields.${path.replaceAll('.', '_')}`,
  defaultLabel: label,
  control,
  options,
  operators: allowedOperators(resolvePath(ticketQuerySchema, path)!.attribute),
});

/** The editor's targeting vocabulary. Path/operator validity comes from the shared query schema. */
export const TICKET_PREDICATE_FIELDS: readonly TicketPredicateField[] = [
  { ...field('board_id', 'Board', 'select', 'boards'), operators: ['equals'] },
  { ...field('category_id', 'Category', 'select', 'categories'), operators: ['equals'] },
  { ...field('subcategory_id', 'Subcategory', 'select', 'subcategories'), operators: ['equals'] },
  { ...field('priority_id', 'Priority', 'select', 'priorities'), operators: ['equals'] },
  { ...field('client.id', 'Client', 'client'), ownerSensitive: true },
  ...WHERE_TAG_FILTERS.map(
    (tag): TicketPredicateField => ({
      ...field(tag.path, tag.defaultLabel, 'tags', { tags: tag.taggedType }),
      operators: ['in', 'not_in'],
    })
  ),
  { ...field('ticket_origin', 'Ticket source', 'multiselect', 'origins'), operators: ['in', 'not_in'] },
  { ...field('title_folded', 'Title', 'text'), fold: 'lower' },
  { ...field('description_folded', 'Description', 'text'), fold: 'lower' },
  field('from_service_request', 'From service request', 'boolean'),
  field('service_request_definition_id', 'Service request', 'select', 'definitions'),
];

/** A schema-valid group may still be richer than the editor; preserve it rather than narrowing it. */
export function isEditableChecklistWhere(where: PredicateGroup): boolean {
  return where.clauses.every((node) => {
    if ('clauses' in node) return false;
    const descriptor = TICKET_PREDICATE_FIELDS.find((candidate) => candidate.path === node.path);
    if (!descriptor?.operators.includes(node.operator)) return false;
    // Select and text controls cannot express null comparisons without changing their meaning.
    if (node.value === null) return false;
    if (Array.isArray(node.value) && node.value.some((value) => typeof value !== 'string')) return false;
    return true;
  });
}

export function normalizeChecklistEditorWhere(where: PredicateGroup): PredicateGroup {
  return {
    ...where,
    clauses: where.clauses.map((node) => {
      if ('clauses' in node) return normalizeChecklistEditorWhere(node);
      const descriptor = TICKET_PREDICATE_FIELDS.find((candidate) => candidate.path === node.path);
      return descriptor?.fold === 'lower' && typeof node.value === 'string'
        ? { ...node, value: unicodeLowerV1(node.value) }
        : node;
    }),
  };
}

export function newChecklistClause(descriptor: TicketPredicateField): PredicateClause {
  const operator = descriptor.operators[0];
  return {
    path: descriptor.path,
    operator,
    value: operator === 'in' || operator === 'not_in' ? [] : descriptor.control === 'boolean' ? true : '',
  };
}
