/**
 * Appointment request schemas.
 *
 * The definitions live in `@alga-psa/scheduling`, which owns appointments. This file
 * used to be a byte-for-byte copy of that one (as did
 * `server/src/lib/schemas/appointmentSchemas.ts`), so a validation message had to be
 * fixed — or translated — in three places to actually change.
 */

export * from '@alga-psa/scheduling/schemas/appointmentSchemas';
