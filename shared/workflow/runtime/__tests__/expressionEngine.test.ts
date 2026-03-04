import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileExpression, validateExpressionSource } from '../expressionEngine';

describe('expressionEngine guardrails', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts runtime-allowlisted helper calls', () => {
    expect(() => validateExpressionSource('coalesce(payload.primary, payload.fallback)')).not.toThrow();
    expect(() => validateExpressionSource('$append(payload.items, payload.extra)')).not.toThrow();
  });

  it('rejects disallowed functions', () => {
    expect(() => validateExpressionSource('$sum([1, 2, 3])')).toThrow('disallowed function');
  });

  it('enforces timeout during evaluation', async () => {
    const compiled = compileExpression({ $expr: 'payload.value' });
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1026);

    await expect(
      compiled.evaluate(
        {
          payload: { value: 42 },
        },
        25
      )
    ).rejects.toThrow('Expression evaluation exceeded 25ms');
  });

  it('rejects non-serializable undefined results', async () => {
    const compiled = compileExpression({ $expr: 'payload.missing' });

    await expect(
      compiled.evaluate({
        payload: {},
      })
    ).rejects.toThrow('Expression result is not JSON-serializable');
  });

  it('enforces maximum output size', async () => {
    const compiled = compileExpression({ $expr: 'payload.big' });
    const oversized = 'x'.repeat(256 * 1024 + 32);

    await expect(
      compiled.evaluate({
        payload: { big: oversized },
      })
    ).rejects.toThrow('Expression result exceeded max output size');
  });
});
