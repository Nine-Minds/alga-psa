/**
 * FR-D3: what sync does with a matched signed-in user, per RMM organization.
 *
 * Deliberately import-free. `userMatching.ts` needs `@alga-psa/db` to find a
 * contact, and a client component that value-imports from it drags knex/pg
 * (and `fs`) into the browser bundle, which fails the whole route's compile.
 * The mapping UIs import these three names from here instead.
 */

export type RmmContactAssignmentMode = 'off' | 'suggest' | 'auto';

export const RMM_CONTACT_ASSIGNMENT_MODES: readonly RmmContactAssignmentMode[] = ['off', 'suggest', 'auto'];

export function isRmmContactAssignmentMode(value: unknown): value is RmmContactAssignmentMode {
  return typeof value === 'string' && (RMM_CONTACT_ASSIGNMENT_MODES as readonly string[]).includes(value);
}
