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
