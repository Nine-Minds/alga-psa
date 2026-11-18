/**
 * @alga-psa/predicates: one condition model (workflow operator names, set semantics) shared by workflow
 * conditions and ticket-list filters. See spec/SEMANTICS.md (contract) and spec/conformance.json (executable form).
 * Root entry is deterministic and Node-free; the PostgreSQL compiler lives in '@alga-psa/predicates/sql'.
 * Recipe for a new dimension: README.md "Adding a ticket-list dimension".
 */
export * from './types';
export * from './schema';
export * from './path';
export * from './evaluate';
export * from './querySchema';
export * from './conformance';
export * from './references';
export * from './unicodeLower';
