import type { Scenario } from '@alga-psa/emulator-host';

/**
 * Rewrites every string in a scenario's step params, e.g. the
 * `http://localhost:4030` default target and `tenant=algasim-tenant` in the
 * bundled Level scenarios, so the same file can aim at an ephemeral
 * webhook-sink or a real Alga route under test.
 */
export function retargetScenario(scenario: Scenario, replacements: Record<string, string>): Scenario {
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return Object.entries(replacements).reduce((text, [from, to]) => text.split(from).join(to), value);
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, rewrite(inner)]));
    }
    return value;
  };
  return { ...scenario, steps: scenario.steps.map((step) => rewrite(step) as Scenario['steps'][number]) };
}
