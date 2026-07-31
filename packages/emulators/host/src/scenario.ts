import { z } from 'zod';
import { ControlError } from './registry';
import type { EmulatorHost } from './host';

/**
 * Declarative setup scripts: seed entities, run actions, arm faults, and
 * advance the clock by registry name. The same file drives CI setup, the
 * CLI (`algasim scenario run`), and one-click buttons in the console.
 *
 * Targets use "<emulator>/<control>" form, e.g. "msgraph/client" or
 * "qbo/transport:error".
 */
const StepSchema = z.union([
  z.object({ advance: z.union([z.string(), z.number()]) }).strict(),
  z.object({ reset: z.string() }).strict(),
  z.object({ seed: z.string(), params: z.unknown().optional() }).strict(),
  z.object({ action: z.string(), params: z.unknown().optional() }).strict(),
  z.object({ arm: z.string(), params: z.unknown().optional() }).strict(),
  z.object({ disarm: z.string() }).strict(),
]);

export const ScenarioSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(StepSchema).min(1),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioStep = z.infer<typeof StepSchema>;

export function parseScenario(raw: unknown): Scenario {
  const result = ScenarioSchema.safeParse(raw);
  if (!result.success) {
    throw new ControlError(400, `Invalid scenario: ${result.error.message}`);
  }
  return result.data;
}

function splitTarget(target: string): { emulatorId: string; name: string } {
  const separator = target.indexOf('/');
  if (separator <= 0 || separator === target.length - 1) {
    throw new ControlError(400, `Invalid target "${target}" — expected "<emulator>/<control>"`);
  }
  return { emulatorId: target.slice(0, separator), name: target.slice(separator + 1) };
}

export interface ScenarioStepResult {
  step: ScenarioStep;
  result: unknown;
}

export async function runScenario(host: EmulatorHost, scenario: Scenario): Promise<ScenarioStepResult[]> {
  const results: ScenarioStepResult[] = [];
  for (const [index, step] of scenario.steps.entries()) {
    try {
      results.push({ step, result: await runStep(host, step) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ControlError(
        err instanceof ControlError ? err.status : 500,
        `Scenario "${scenario.name}" failed at step ${index + 1} (${JSON.stringify(step)}): ${message}`,
      );
    }
  }
  return results;
}

async function runStep(host: EmulatorHost, step: ScenarioStep): Promise<unknown> {
  if ('advance' in step) {
    host.clock.advance(step.advance);
    return { now: host.clock.now().toISOString(), offsetMs: host.clock.offset };
  }
  if ('reset' in step) {
    await host.reset(step.reset);
    return null;
  }
  if ('seed' in step) {
    const { emulatorId, name } = splitTarget(step.seed);
    return host.instance(emulatorId).controls.runSeeder(name, step.params);
  }
  if ('action' in step) {
    const { emulatorId, name } = splitTarget(step.action);
    return host.instance(emulatorId).controls.runAction(name, step.params);
  }
  if ('arm' in step) {
    const { emulatorId, name } = splitTarget(step.arm);
    await host.instance(emulatorId).controls.armFault(name, step.params);
    return null;
  }
  const { emulatorId, name } = splitTarget(step.disarm);
  await host.instance(emulatorId).controls.disarmFault(name);
  return null;
}
