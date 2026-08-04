/* @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { createProjectSchema, updateProjectSchema } from '../project.schemas';

describe('project budgeted-hours validation', () => {
  it('normalizes a PostgreSQL bigint string to numeric minutes', () => {
    expect(updateProjectSchema.parse({ budgeted_hours: '120' })).toEqual({
      budgeted_hours: 120,
    });
  });

  it.each([
    { input: 120, expected: 120 },
    { input: null, expected: null },
    { input: undefined, expected: undefined },
  ])('preserves $input', ({ input, expected }) => {
    const parsed = updateProjectSchema.parse(
      input === undefined ? {} : { budgeted_hours: input },
    );

    expect(parsed.budgeted_hours).toBe(expected);
  });

  it.each([
    ['empty text', ''],
    ['whitespace-only text', '   '],
    ['non-numeric text', 'not-a-number'],
    ['a negative number', -1],
    ['a negative numeric string', '-1'],
    ['a fractional number of minutes', 1.5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s', (_description, budgetedHours) => {
    expect(
      updateProjectSchema.safeParse({ budgeted_hours: budgetedHours }).success,
    ).toBe(false);
  });

  it('applies the same normalization when creating a project', () => {
    const result = createProjectSchema.pick({ budgeted_hours: true }).parse({
      budgeted_hours: ' 240 ',
    });

    expect(result.budgeted_hours).toBe(240);
  });

  it('does not affect unrelated partial updates', () => {
    expect(updateProjectSchema.parse({ project_name: 'Updated project' })).toEqual({
      project_name: 'Updated project',
    });
  });
});
