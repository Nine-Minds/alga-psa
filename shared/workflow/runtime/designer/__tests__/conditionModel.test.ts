import { describe, expect, it } from 'vitest';

import {
  parseConditionExpression,
  serializeConditionGroup,
  type WorkflowConditionGroup,
} from '../conditionModel';
import { evaluateExpressionSource, validateExpressionSource } from '../../expressionEngine';

const PRIORITY_PATH = 'vars.ticketLookup.ticket.priority_id';

describe('workflow condition model', () => {
  it('serializes an empty group to an empty expression and parses it back', () => {
    expect(serializeConditionGroup({ join: 'and', clauses: [] })).toBe('');
    expect(parseConditionExpression('')).toEqual({ join: 'and', clauses: [] });
    expect(parseConditionExpression('   ')).toEqual({ join: 'and', clauses: [] });
  });

  it('round-trips every operator through the expression form', () => {
    const group: WorkflowConditionGroup = {
      join: 'and',
      clauses: [
        { path: PRIORITY_PATH, operator: 'equals', value: 'p1' },
        { path: 'payload.board', operator: 'not_equals', value: 'b1' },
        { path: 'payload.statusId', operator: 'in', value: ['s1', 's2'] },
        { path: 'payload.statusId', operator: 'not_in', value: ['s3'] },
        { path: 'payload.count', operator: 'gt', value: 3 },
        { path: 'payload.count', operator: 'gte', value: -1 },
        { path: 'payload.count', operator: 'lt', value: 10.5 },
        { path: 'payload.count', operator: 'lte', value: 0 },
        { path: 'payload.title', operator: 'contains', value: 'outage "major"' },
        { path: 'payload.title', operator: 'starts_with', value: 'RE:' },
        { path: 'payload.title', operator: 'ends_with', value: '!' },
        { path: 'payload.note', operator: 'is_empty' },
        { path: 'payload.note', operator: 'is_not_empty' },
        { path: 'payload.flag', operator: 'equals', value: true },
        { path: 'payload.other', operator: 'equals', value: null },
      ],
    };

    const expression = serializeConditionGroup(group);
    expect(() => validateExpressionSource(expression)).not.toThrow();
    expect(parseConditionExpression(expression)).toEqual(group);
  });

  it('round-trips an or group', () => {
    const group: WorkflowConditionGroup = {
      join: 'or',
      clauses: [
        { path: PRIORITY_PATH, operator: 'equals', value: 'p1' },
        { path: PRIORITY_PATH, operator: 'equals', value: 'p2' },
      ],
    };
    const expression = serializeConditionGroup(group);
    expect(expression).toBe(`${PRIORITY_PATH} = "p1" or ${PRIORITY_PATH} = "p2"`);
    expect(parseConditionExpression(expression)).toEqual(group);
  });

  it('quotes path segments that are not plain identifiers', () => {
    const expression = serializeConditionGroup({
      join: 'and',
      clauses: [{ path: 'vars.my step.value', operator: 'equals', value: 1 }],
    });
    expect(expression).toBe('vars.`my step`.value = 1');
    expect(parseConditionExpression(expression)?.clauses[0].path).toBe('vars.my step.value');
  });

  it('parses hand-written expressions that fit the model, including == and parentheses', () => {
    expect(parseConditionExpression('(payload.a == "x") and payload.b > 2')).toEqual({
      join: 'and',
      clauses: [
        { path: 'payload.a', operator: 'equals', value: 'x' },
        { path: 'payload.b', operator: 'gt', value: 2 },
      ],
    });
  });

  it('returns null for expressions the builder cannot represent', () => {
    expect(parseConditionExpression('payload.a = "x" and (payload.b = 1 or payload.c = 2)')).toBeNull();
    expect(parseConditionExpression('payload.a = payload.b')).toBeNull();
    expect(parseConditionExpression('len(payload.items) > 0')).toBeNull();
    expect(parseConditionExpression('payload.items[0].a = 1')).toBeNull();
    expect(parseConditionExpression('payload.a = ')).toBeNull();
  });

  it('serialized conditions evaluate as intended at run time', async () => {
    const context = {
      payload: { title: 'Major outage', note: null, statusId: 's2', count: 4 },
      vars: { ticketLookup: { ticket: { priority_id: 'p1' } } },
    };
    const evaluate = (group: WorkflowConditionGroup) =>
      evaluateExpressionSource(serializeConditionGroup(group), context);

    await expect(evaluate({ join: 'and', clauses: [{ path: PRIORITY_PATH, operator: 'equals', value: 'p1' }] })).resolves.toBe(true);
    await expect(evaluate({ join: 'and', clauses: [{ path: 'payload.statusId', operator: 'not_in', value: ['s1', 's2'] }] })).resolves.toBe(false);
    await expect(evaluate({ join: 'and', clauses: [{ path: 'payload.statusId', operator: 'in', value: ['s1', 's2'] }] })).resolves.toBe(true);
    await expect(evaluate({ join: 'and', clauses: [{ path: 'payload.title', operator: 'contains', value: 'outage' }] })).resolves.toBe(true);
    await expect(evaluate({ join: 'and', clauses: [{ path: 'payload.note', operator: 'is_empty' }] })).resolves.toBe(true);
    await expect(evaluate({ join: 'and', clauses: [{ path: 'payload.missing', operator: 'is_empty' }] })).resolves.toBe(true);
    await expect(evaluate({ join: 'and', clauses: [{ path: 'payload.title', operator: 'is_not_empty' }] })).resolves.toBe(true);
    await expect(evaluate({
      join: 'or',
      clauses: [
        { path: 'payload.count', operator: 'lt', value: 2 },
        { path: 'payload.title', operator: 'starts_with', value: 'Major' },
      ],
    })).resolves.toBe(true);
  });
});
