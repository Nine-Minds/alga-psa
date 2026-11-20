import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileExpression, evaluateExpressionSource, validateExpressionSource, verifyBudgetHooksActive } from '../expressionEngine';

describe('expressionEngine guardrails', () => {
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

  it.each([
    '($append := $eval; $append("1+1"))',
    '[$eval]@$append.$append("1+1")',
    '( $workflowBoundedRange := $eval; [1..4] )',
    '({"append": $eval}).append("1+1")',
    '"1+1" ~> ({"append": $eval}).append',
  ])('prevents unchecked interpreter calls through helper aliases: %s', async (source) => {
    expect(() => validateExpressionSource(source)).toThrow(/protected function|dynamic|cannot be validated/);
    await expect(evaluateExpressionSource(source, {})).rejects.toThrow(/protected function|dynamic|cannot be validated/);
  });

  it('rejects ~> application of non-allowlisted functions and variables', () => {
    expect(() => validateExpressionSource('payload.x ~> $uppercase')).toThrow('disallowed function');
    expect(() => validateExpressionSource('1 ~> $f')).toThrow('disallowed function');
  });

  it('accepts ~> application of allowlisted helpers', () => {
    expect(() => validateExpressionSource('payload.name ~> $toString')).not.toThrow();
  });

  it('rejects range bombs before allocating their sequences', () => {
    expectRunInBoundedProcess('range-bomb', /range exceeded max size/i);
  });

  it('rejects excessive nesting before parsing', () => {
    expectRunInBoundedProcess('deep-nesting', /nesting exceeded max depth/i);
  });

  it('rejects expression ASTs with excessive operator chains', () => {
    expectRunInBoundedProcess('long-chain', /AST exceeded max (size|depth)/i);
  });

  it('charges dynamic ranges to one aggregate allocation budget', () => {
    expectRunInBoundedProcess('aggregate-ranges', /aggregate range budget exceeded/i);
  });

  it('interrupts runtime traversal after its deterministic instruction budget', () => {
    expectRunInBoundedProcess('runtime-interruption', /execution budget exceeded/i);
  });

  it('shares the range budget across nested expression frames', async () => {
    await expect(evaluateExpressionSource(
      '[[1..payload.n],([1..payload.n]),([1..payload.n]),([1..payload.n]),([1..payload.n])]',
      { payload: { n: 1000 } }
    )).rejects.toThrow(/aggregate range budget exceeded/i);
  });

  it('starts a fresh budget for each use of a compiled expression', async () => {
    const compiled = compileExpression({ $expr: '[1..payload.n]' });
    for (let index = 0; index < 3; index += 1) {
      await expect(compiled.evaluate({ payload: { n: 3000 } })).resolves.toHaveLength(3000);
    }
    await expect(compiled.evaluate({ payload: { n: 5000 } })).rejects.toThrow(/range exceeded/i);
    await expect(compiled.evaluate({ payload: { n: 3000 } })).resolves.toHaveLength(3000);
  });

  it('isolates concurrent evaluations of a cached expression', async () => {
    const compiled = compileExpression({ $expr: '([1..payload.n])' });
    const results = await Promise.allSettled([3000, 5000, 2000, 3000].map((n) => compiled.evaluate({ payload: { n } })));
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: expect.arrayContaining([1, 3000]) });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringMatching(/range exceeded/) }) });
    expect(results[2]).toMatchObject({ status: 'fulfilled', value: expect.arrayContaining([1, 2000]) });
    expect(results[3]).toMatchObject({ status: 'fulfilled', value: expect.arrayContaining([1, 3000]) });
  });

  it('self-check passes against the real jsonata, proving the budget hooks fire', async () => {
    await expect(verifyBudgetHooksActive()).resolves.toBeUndefined();
    // The guard is also exercised transitively by every other evaluation test,
    // which route through evaluate() -> ensureBudgetHooksActive().
    await expect(evaluateExpressionSource('1 + 1', {})).resolves.toBe(2);
  });

  it('fails closed when jsonata stops invoking the evaluate hooks', async () => {
    // Simulate a future jsonata whose assign() no longer wires the hooks and
    // whose evaluate() never calls them. The real counters would be silent, so
    // the self-check must refuse rather than report healthy.
    const silentFactory = (() => ({
      assign: () => {},
      evaluate: async () => 2,
    })) as unknown as Parameters<typeof verifyBudgetHooksActive>[0];
    await expect(verifyBudgetHooksActive(silentFactory)).rejects.toThrow(/budget enforcement is inactive/i);
  });

  it('fails closed when jsonata stops exposing the base execution frame', async () => {
    // Hooks fire, but with no `base` frame the per-invocation budget cannot be
    // keyed or shared across frames; treat that as a broken contract too.
    const framelessFactory = (() => ({
      assign(_name: unknown, fn: (...a: unknown[]) => void) {
        this._hooks = this._hooks ?? [];
        this._hooks.push(fn);
      },
      async evaluate() {
        for (const fn of this._hooks ?? []) fn(null, null, {} /* no base */, 2);
        return 2;
      },
      _hooks: [] as Array<(...a: unknown[]) => void>,
    })) as unknown as Parameters<typeof verifyBudgetHooksActive>[0];
    await expect(verifyBudgetHooksActive(framelessFactory)).rejects.toThrow(/budget enforcement is inactive/i);
  });

  it('accepts repeated object and array references in serializable output', async () => {
    for (const x of [{ a: 1 }, [{ a: 1 }]]) {
      await expect(evaluateExpressionSource('{"a": payload.x, "b": payload.x}', { payload: { x } }))
        .resolves.toEqual({ a: x, b: x });
    }
    await expect(evaluateExpressionSource('[payload.x, payload.x]', { payload: { x: { a: 1 } } }))
      .resolves.toEqual([{ a: 1 }, { a: 1 }]);
  });

  it('rejects cycles with a controlled error', async () => {
    const x: Record<string, unknown> = {};
    x.self = x;
    await expect(evaluateExpressionSource('payload.x', { payload: { x } })).rejects.toThrow(/cyclic value/);
  });

  it('counts every alias occurrence before output serialization', async () => {
    const x = { text: 'x'.repeat(140_000) };
    await expect(evaluateExpressionSource('[payload.x, payload.x]', { payload: { x } }))
      .rejects.toThrow(/max output size/);
  });

  it('bounds deeply shared input before helper coercion', () => {
    expectRunInBoundedProcess('alias-expansion', /exceeded max (size|depth)/i);
  });

  it('bounds intermediate alias expansion before a native comparison', () => {
    expectRunInBoundedProcess('intermediate-expansion', /allocation budget exceeded|exceeded max size/i);
  });

  it('accounts for JSON escaping at the output limit', async () => {
    await expect(evaluateExpressionSource('payload.text', { payload: { text: '\ud800'.repeat(44_000) } }))
      .rejects.toThrow(/max output size/);
    await expect(evaluateExpressionSource('payload.text', { payload: { text: 'x'.repeat(262_142) } }))
      .resolves.toHaveLength(262_142);
  });

  it('bounds source length for validation and evaluation', async () => {
    const source = '"' + 'x'.repeat(8192) + '"';
    expect(() => validateExpressionSource(source)).toThrow(/source exceeded max length/);
    await expect(evaluateExpressionSource(source, {})).rejects.toThrow(/source exceeded max length/);
  });

  it('checks traversal work even without a helper call', () => {
    expectRunInBoundedProcess('ast-interruption', /execution budget exceeded/i);
  });

  it('keeps ordinary range and helper expressions compatible', async () => {
    await expect(evaluateExpressionSource('notContains(["hello", "world"], "x")', {})).resolves.toBe(true);
    await expect(evaluateExpressionSource('coalesce(payload.name, "unknown") & "!"', { payload: { name: 'Ada' } }))
      .resolves.toBe('Ada!');
    await expect(evaluateExpressionSource('[1..4]', {})).resolves.toEqual([1, 2, 3, 4]);
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

    it('stays linear on large text', async () => {
      // The input fits the bounded input contract and helper work completes within
      // the deterministic allocation and traversal budgets.
      const big = 'x'.repeat(200_000);
      await expect(
        evaluateExpressionSource('len(truncate(payload.big, 1000000))', { payload: { big } })
      ).resolves.toBe(100_000);
      await expect(
        evaluateExpressionSource('len(substring(payload.big, -10))', { payload: { big } })
      ).resolves.toBe(10);
    });

    it('stays linear on large text containing emoji', async () => {
      // Exercise the code-point path on a large input within the same resource bounds.
      const big = 'x😀'.repeat(100_000);
      const payload = { big };
      // 100,000 characters = 50,000 'x😀' pairs; len() counts UTF-16 units.
      await expect(
        evaluateExpressionSource('len(truncate(payload.big, 1000000, ""))', { payload })
      ).resolves.toBe(150_000);
      await expect(evaluateExpressionSource('truncate(payload.big, 4, "")', { payload })).resolves.toBe('x😀x😀');
      await expect(evaluateExpressionSource('substring(payload.big, -3)', { payload })).resolves.toBe('😀x😀');
    });

    it('treats a lone surrogate as one character', async () => {
      await expect(run('substring(payload.s, 1, 2)', { s: 'a\uD83Db\uDE00c' })).resolves.toBe('\uD83Db');
      await expect(run('truncate(payload.s, 3, "")', { s: '\uDE00😀ab' })).resolves.toBe('\uDE00😀a');
    });

    it('finds the same characters whether a position is nearer the start or the end of the text', async () => {
      // Positions past the middle are located by walking back from the end; both walks
      // must agree with code-point splitting, lone surrogates included.
      const s = 'a😀\uDE00b\uD83D😀c\uDE00\uD83Dd😀';
      const chars = Array.from(s);
      for (let start = -chars.length; start <= chars.length; start += 1) {
        const from = start < 0 ? chars.length + start : start;
        await expect(run('substring(payload.s, payload.start)', { s, start })).resolves.toBe(chars.slice(from).join(''));
        for (let length = 0; length <= chars.length - from + 1; length += 1) {
          await expect(run('substring(payload.s, payload.start, payload.length)', { s, start, length })).resolves.toBe(
            chars.slice(from, from + length).join('')
          );
        }
      }
      for (let max = 0; max <= chars.length; max += 1) {
        await expect(run('truncate(payload.s, payload.max, "")', { s, max })).resolves.toBe(chars.slice(0, max).join(''));
      }
    });

    it('is accepted by the validator the designer uses', () => {
      expect(() => validateExpressionSource('truncate(payload.a, 10) & substring(payload.b, 0, 3)')).not.toThrow();
    });
  });
});

function expectRunInBoundedProcess(scenario: string, expectedError: RegExp): void {
  const childPath = fileURLToPath(new URL('./expressionEngine.securityChild.ts', import.meta.url));
  const child = spawnSync(
    process.execPath,
    ['--max-old-space-size=96', '--import', 'tsx/esm', childPath, scenario],
    { encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024 }
  );
  expect(child.error, child.error?.message).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const result = JSON.parse(child.stdout) as { error?: string; value?: unknown };
  expect(result.error).toMatch(expectedError);
}

