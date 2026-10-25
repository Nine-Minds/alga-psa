import { z } from 'zod';
import { PREDICATE_OPERATORS, operatorTakesList, operatorTakesValue } from './types';
import type { PredicateClause, PredicateGroup } from './types';

const literalSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const predicateClauseSchema: z.ZodType<PredicateClause> = z
  .object({
    path: z.string().min(1),
    operator: z.enum(PREDICATE_OPERATORS),
    value: z.union([literalSchema, z.array(literalSchema)]).optional(),
  })
  .strict()
  .superRefine((clause, ctx) => {
    const { operator, value } = clause;
    if (!operatorTakesValue(operator)) {
      if (value !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: `${operator} takes no value` });
      }
      return;
    }
    if (value === undefined) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: `${operator} requires a value` });
      return;
    }
    if (operatorTakesList(operator) !== Array.isArray(value)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: operatorTakesList(operator) ? `${operator} requires a list` : `${operator} requires a single value`,
      });
    }
  }) as z.ZodType<PredicateClause>;

export const predicateGroupSchema: z.ZodType<PredicateGroup> = z.lazy(() =>
  z
    .object({
      join: z.enum(['and', 'or']),
      clauses: z.array(z.union([predicateClauseSchema, predicateGroupSchema])),
    })
    .strict(),
) as z.ZodType<PredicateGroup>;
