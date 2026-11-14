import type { AuthorizationEvaluationInput } from './contracts';

/**
 * Principal-level admission for mutations, the counterpart of the tenant-level write admission in
 * `@alga-psa/db`. A domain whose rule depends on WHO is writing (a seat technician whose allocation
 * has lapsed) registers ONE gate here; every kernel's `authorizeMutation` consults it through the
 * built-in provider, so no action repeats the check. Throw to refuse: the gate owns its error type.
 *
 * It is consulted for mutations only, never for `authorizeResource`, so reads and sign-in are
 * untouched. Only internal subjects reach it (client-portal requesters and service principals return
 * before it, and with no gate registered nothing is read at all).
 *
 * On `globalThis` for the same reason as the write-admission registrations: separately bundled
 * copies of this package share one gate.
 */
export type MutationAdmissionGate = (input: AuthorizationEvaluationInput) => Promise<void>;

declare global {
  // eslint-disable-next-line no-var
  var __algaMutationAdmissionGate: MutationAdmissionGate | undefined;
}

export function registerMutationAdmissionGate(gate: MutationAdmissionGate): void {
  globalThis.__algaMutationAdmissionGate = gate;
}

export function resetMutationAdmissionGate(): void {
  globalThis.__algaMutationAdmissionGate = undefined;
}

export async function admitMutation(input: AuthorizationEvaluationInput): Promise<void> {
  const gate = globalThis.__algaMutationAdmissionGate;
  if (!gate || input.subject.userType !== 'internal') return;
  await gate(input);
}
