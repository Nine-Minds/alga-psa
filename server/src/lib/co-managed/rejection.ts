import { CoManagedAdmissionError } from '@alga-psa/licensing';
import { CoManagedSeatArrangementError, CoManagedSeatInvitationError } from '@alga-psa/co-managed';

/**
 * A refusal the screen can name, returned as data because a thrown error reaches the browser as a
 * redacted failure. Shared by the seat actions and the Seat trial actions so there is one mapping.
 * (Not in a `'use server'` file: those may only export async functions.)
 */
export type CoManagedRejection = { rejected: true; errorCode: string };

/** The EE trial refusal, recognised by name so this CE-reachable module need not import EE code. */
const isSeatTrialError = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && error.name === 'CoManagedSeatTrialError' && typeof (error as { code?: unknown }).code === 'string';

/** Maps a known refusal to `{ rejected, errorCode }`; anything else is rethrown. */
export const refused = (error: unknown): CoManagedRejection => {
  if (error instanceof CoManagedSeatArrangementError || error instanceof CoManagedSeatInvitationError ||
      error instanceof CoManagedAdmissionError || isSeatTrialError(error)) return { rejected: true, errorCode: error.code };
  throw error;
};
