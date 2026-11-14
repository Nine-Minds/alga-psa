/**
 * The refusal a co-managed seat technician's role and team guard raises, and how to recognise it.
 *
 * The check itself (`assertSeatTechnicianWrite`) reads the database and lives in `@alga-psa/db`.
 * Its error lives here, with no server dependency, because action error mappers that client
 * bundles import (for example `@alga-psa/teams` `teamActionErrors`) must recognise it without
 * pulling the database layer into the browser.
 */

/** The seat role's name, as seat admission seeds it (`msp = true`, `client = false`). */
export const CO_MANAGED_SEAT_ROLE_NAME = 'Seat Technician';

export type SeatTechnicianGuardCode = 'SEAT_TECHNICIAN_ROLE_REFUSED' | 'SEAT_TECHNICIAN_TEAM_REFUSED';

const SEAT_TECHNICIAN_GUARD_MESSAGES: Record<SeatTechnicianGuardCode, string> = {
  SEAT_TECHNICIAN_ROLE_REFUSED: 'A co-managed seat technician can hold only the seat role. Convert them to an MSP user first.',
  SEAT_TECHNICIAN_TEAM_REFUSED: 'A co-managed seat technician cannot be added to an MSP team. Convert them to an MSP user first.',
};

export class SeatTechnicianGuardError extends Error {
  readonly name = 'SeatTechnicianGuardError';
  readonly statusCode = 409;
  constructor(readonly code: SeatTechnicianGuardCode, readonly userIds: readonly string[]) {
    super(SEAT_TECHNICIAN_GUARD_MESSAGES[code]);
  }
}

/** Recognises the error across bundle boundaries, where instanceof can fail. */
export function isSeatTechnicianGuardError(error: unknown): error is SeatTechnicianGuardError {
  return error instanceof SeatTechnicianGuardError
    || (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'SeatTechnicianGuardError');
}
