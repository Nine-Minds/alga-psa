/**
 * Registers the seat technician write gate with the authorization kernel's mutation boundary.
 *
 * Registration is a side effect of importing this module, which `./capability` does, so every host
 * that registers the co-managed capabilities (server entry, Temporal worker) installs it. The rule
 * itself lives in `@alga-psa/licensing` (`assertCoManagedSeatTechnicianWrite`); this only wires it to
 * the one place every kernel mutation passes through. Reads (`authorizeResource`) never reach it.
 */
import { registerMutationAdmissionGate } from '@alga-psa/authorization/kernel/mutationAdmission';
import { getAdminConnection } from '@alga-psa/db';
import { assertCoManagedSeatTechnicianWrite } from '@alga-psa/licensing/co-managed-seat-write-admission';

export function registerCoManagedSeatWriteAdmission(): void {
  registerMutationAdmissionGate(async (input) => {
    const { tenant, userId } = input.subject;
    if (!tenant || !userId) return;
    await assertCoManagedSeatTechnicianWrite(input.knex ?? await getAdminConnection(), tenant, userId);
  });
}

registerCoManagedSeatWriteAdmission();
