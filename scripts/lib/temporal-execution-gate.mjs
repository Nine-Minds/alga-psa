import { evaluateExecutionGate } from './workspace-execution-gate.mjs';
export const temporalRequirements = [
  { suite: 'temporal-readiness', job: 'fast-readiness', shards: 1 },
  { suite: 'temporal-engine', job: 'engine-tests', shards: 1 },
];
export function evaluateTemporalGate(input) {
  return evaluateExecutionGate({ ...input, requirements: temporalRequirements, scope: 'temporal-tests' });
}
