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

  describe('truncate and substring', () => {
    const run = (source: string, payload: Record<string, unknown> = {}) => evaluateExpressionSource(source, { payload });

    it('truncates to at most length characters, ending included', async () => {
      await expect(run('truncate(payload.note, 10)', { note: 'The printer is on fire again' })).resolves.toBe('The pri...');
      await expect(run('truncate(payload.note, 10, "")', { note: 'The printer is on fire again' })).resolves.toBe('The printe');
      await expect(run('truncate(payload.note, 10, " (more)")', { note: 'The printer is on fire again' })).resolves.toBe('The (more)');
      await expect(run('truncate(payload.note, 50)', { note: 'short' })).resolves.toBe('short');
      await expect(run('$truncate(payload.note, 2)', { note: 'abcdef' })).resolves.toBe('..');
    });

    it('counts characters, not UTF-16 units, so emoji are never split', async () => {
      await expect(run('truncate(payload.note, 3, "")', { note: '😀😀😀😀' })).resolves.toBe('😀😀😀');
      await expect(run('substring(payload.note, 1, 2)', { note: 'a😀b😀' })).resolves.toBe('😀b');
    });

    it('treats missing text as empty and rejects a missing length', async () => {
      await expect(run('truncate(payload.missing, 5)')).resolves.toBe('');
      await expect(run('substring(payload.missing, 0, 5)')).resolves.toBe('');
      await expect(run('truncate(payload.note, payload.missing)', { note: 'abc' })).rejects.toThrow('truncate: length must be a number');
    });

    it('takes part of the text, counting a negative start from the end', async () => {
      await expect(run('substring(payload.s, 0, 5)', { s: 'Hello world' })).resolves.toBe('Hello');
      await expect(run('substring(payload.s, 6)', { s: 'Hello world' })).resolves.toBe('world');
      await expect(run('substring(payload.s, -5)', { s: 'Hello world' })).resolves.toBe('world');
      await expect(run('substring(payload.s, 50)', { s: 'Hello world' })).resolves.toBe('');
      await expect(run('substring(payload.s, 2, -1)', { s: 'Hello world' })).resolves.toBe('');
      await expect(run('substring(payload.s, 1.9, 2.9)', { s: 'Hello world' })).resolves.toBe('el');
    });

    it('stays well inside the evaluation budget on large text', async () => {
      const big = 'x'.repeat(200_000);
      await expect(run('len(truncate(payload.big, 1000000))', { big })).resolves.toBe(100_000);
      await expect(run('len(substring(payload.big, -10))', { big })).resolves.toBe(10);
    });

    it('stays well inside the evaluation budget on large text containing emoji', async () => {
      const big = 'x😀'.repeat(100_000);
      // 100,000 characters = 50,000 'x😀' pairs; len() counts UTF-16 units.
      await expect(run('len(truncate(payload.big, 1000000, ""))', { big })).resolves.toBe(150_000);
      await expect(run('truncate(payload.big, 4, "")', { big })).resolves.toBe('x😀x😀');
      await expect(run('substring(payload.big, -3)', { big })).resolves.toBe('😀x😀');
    });

    it('treats a lone surrogate as one character', async () => {
      await expect(run('substring(payload.s, 1, 2)', { s: 'a\uD83Db\uDE00c' })).resolves.toBe('\uD83Db');
      await expect(run('truncate(payload.s, 3, "")', { s: '\uDE00😀ab' })).resolves.toBe('\uDE00😀a');
    });

    it('is accepted by the validator the designer uses', () => {
      expect(() => validateExpressionSource('truncate(payload.a, 10) & substring(payload.b, 0, 3)')).not.toThrow();
    });
  });
});

