import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileExpression, evaluateExpressionSource, validateExpressionSource } from '../expressionEngine';

describe('expressionEngine guardrails', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts runtime-allowlisted helper calls', () => {
    expect(() => validateExpressionSource('coalesce(payload.primary, payload.fallback)')).not.toThrow();
    expect(() => validateExpressionSource('$append(payload.items, payload.extra)')).not.toThrow();
  });

  it('accepts boolean operators followed by parenthesized expressions', () => {
    expect(() => validateExpressionSource('vars.x = 0 and (vars.y = 1 or vars.z = 2)')).not.toThrow();
    expect(() => validateExpressionSource('(vars.y = 1 or vars.z = 2) and vars.x = 0')).not.toThrow();
    expect(() => validateExpressionSource('vars.a in (vars.values)')).not.toThrow();
    expect(() => validateExpressionSource('vars.a = 1 or (vars.b = 2)')).not.toThrow();
  });

  it('accepts nested parenthesized expressions after operators', () => {
    expect(() =>
      validateExpressionSource('vars.a = 1 and ((vars.b = 2 or (vars.c = 3)))')
    ).not.toThrow();
  });

  it('rejects disallowed functions', () => {
    expect(() => validateExpressionSource('$sum([1, 2, 3])')).toThrow('disallowed function');
    expect(() => validateExpressionSource('$count(payload.items)')).toThrow('disallowed function');
    expect(() => validateExpressionSource('foo(payload.items)')).toThrow('disallowed function');
  });

  it('rejects lambda definitions, including recursive and immediately-invoked forms', () => {
    expect(() => validateExpressionSource('function($x){ $x + 1 }(5)')).toThrow('lambda');
    expect(() =>
      validateExpressionSource('($f := function($x){ $x ~> $f }; 1 ~> $f)')
    ).toThrow('lambda');
    expect(() => validateExpressionSource('$map(payload.items, function($v){ $v })')).toThrow('lambda');
  });

  it('rejects ~> application of non-allowlisted functions and variables', () => {
    expect(() => validateExpressionSource('payload.x ~> $uppercase')).toThrow('disallowed function');
    expect(() => validateExpressionSource('1 ~> $f')).toThrow('disallowed function');
  });

  it('accepts ~> application of allowlisted helpers', () => {
    expect(() => validateExpressionSource('payload.name ~> $toString')).not.toThrow();
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

  it('evaluates ad-hoc expression source against custom context', async () => {
    await expect(
      evaluateExpressionSource('coalesce(source.customer.email, vars.fallbackEmail)', {
        source: { customer: {} },
        vars: { fallbackEmail: 'fallback@example.com' },
      })
    ).resolves.toBe('fallback@example.com');
  });
});
