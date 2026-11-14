import { evaluateExpressionSource } from '../expressionEngine';

const scenario = process.argv[2];

async function run(): Promise<unknown> {
  switch (scenario) {
    case 'range-bomb':
      return evaluateExpressionSource(
        'notContains([[1..10000000],[1..10000000],[1..10000000]], "x")',
        {}
      );
    case 'deep-nesting':
      return evaluateExpressionSource(`${'('.repeat(1_000)}1${')'.repeat(1_000)}`, {});
    case 'long-chain':
      return evaluateExpressionSource(`${'1+'.repeat(1_200)}1`, {});
    case 'aggregate-ranges': {
      const repeatedDynamicRange = Array.from({ length: 5 }, () => '[payload.start..payload.end]').join(',');
      return evaluateExpressionSource(`[${repeatedDynamicRange}]`, { payload: { start: 1, end: 1_000 } });
    }
    case 'alias-expansion': {
      let value: unknown = ['x'];
      for (let index = 0; index < 30; index += 1) value = [value, value];
      return evaluateExpressionSource('toString(payload.x)', { payload: { x: value } });
    }
    case 'intermediate-expansion': {
      const assignments = Array.from({ length: 24 }, () => '$x := {"a": $x, "b": $x}').join(';');
      return evaluateExpressionSource(`($x := {"value": "x"}; ${assignments}; $x = $x)`, {});
    }
    case 'ast-interruption':
      return evaluateExpressionSource('payload.items.(value + 1)', {
        payload: { items: Array.from({ length: 2000 }, () => ({ value: 1 })) }
      });
    case 'runtime-interruption': {
      const items = Array.from({ length: 4_096 }, () => 'item');
      return evaluateExpressionSource('notContains(payload.items, "!")', { payload: { items } });
    }
    default:
      throw new Error(`Unknown security child scenario: ${scenario}`);
  }
}

try {
  const value = await run();
  process.stdout.write(JSON.stringify({ value }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
}
