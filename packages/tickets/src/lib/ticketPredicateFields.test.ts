import { describe, expect, it } from 'vitest';
import { COMPLEMENTS, TEXT_OPERATORS } from '@alga-psa/predicates';
import { TICKET_PREDICATE_FIELDS } from './ticketPredicateFields';

describe('ticket predicate fields: negative text operators', () => {
  const negativeText = Object.entries(COMPLEMENTS)
    .filter(([, positive]) => TEXT_OPERATORS.includes(positive!))
    .map(([negative]) => negative);

  it.each(['title_folded', 'description_folded'])('%s offers every negative text operator wherever it offers the positive one', (path) => {
    const operators = TICKET_PREDICATE_FIELDS.find((field) => field.path === path)!.operators;
    expect(negativeText).toHaveLength(3);
    for (const operator of negativeText) expect(operators).toContain(operator);
    for (const operator of TEXT_OPERATORS) expect(operators).toContain(operator);
  });
});

describe('ticket predicate fields: checklist Client rule (T006)', () => {
  // The query schema accepts client.id not_in for the ticket list; the checklist rule editor keeps
  // Client pinned to equals/in so a stored not_in rule stays a preserved, non-editable rule there.
  it('keeps the Client rule editor field pinned to equals/in', () => {
    expect(TICKET_PREDICATE_FIELDS.find((field) => field.path === 'client.id')?.operators).toEqual(['equals', 'in']);
  });
});
