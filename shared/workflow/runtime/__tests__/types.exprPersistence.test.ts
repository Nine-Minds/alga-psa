import { describe, expect, it } from 'vitest';
import { exprSchema, stepSchema } from '../types';

describe('workflow expression persistence contract', () => {
  it('preserves expression values as {$expr: string} objects in step schemas', () => {
    const parsed = stepSchema.parse({
      id: 'if-1',
      type: 'control.if',
      condition: { $expr: 'payload.ready' },
      then: [],
    });

    expect(parsed.type).toBe('control.if');
    if (!('condition' in parsed)) return;
    expect(parsed.condition).toEqual({ $expr: 'payload.ready' });
    expect(Object.prototype.hasOwnProperty.call(parsed.condition, '$expr')).toBe(true);
  });

  it('rejects bare string expressions for persisted Expr schema', () => {
    expect(exprSchema.safeParse('payload.ready').success).toBe(false);
    expect(exprSchema.parse({ $expr: 'payload.ready', extra: 'ignored' })).toEqual({
      $expr: 'payload.ready',
    });
  });

  it('rejects control.forEach concurrency values greater than 1', () => {
    const result = stepSchema.safeParse({
      id: 'for-1',
      type: 'control.forEach',
      items: { $expr: 'payload.items' },
      itemVar: 'item',
      concurrency: 2,
      body: [],
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues ?? [])).toContain('concurrency > 1');
  });
});
