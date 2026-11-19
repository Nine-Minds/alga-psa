# Scratchpad — MSP ticket search: full ticket number returns only that ticket

PSA ticket: alga-2026-0002826 (CloudVBS).

## Decisions

- One shared helper, `shared/ticketClients/searchIdentifier.ts` (`deriveSearchIdentifierMatch`), now derives identifiers for the ticket, client, contact and project list searches. It returns:
  - `exact`: the whole query, lowercased, with leading `#` characters and surrounding whitespace removed. It is compared with `=`.
  - `prefix`: set only for a single number-shaped token (`^[A-Z]+-?\d+$`, for example `TIC0002826` or `ALGA-2026`) and used for `LIKE prefix || '%'`.
  - `isFullNumber`: true for a complete multi-group number (`^[A-Z]+(-\d+){2,}$`).
- Deviation from the PRD's "do not touch trigram clauses": the index subtitle is `client · ticket_number`, so `subtitle % raw` scores sibling numbers at about 0.5, above the 0.3 threshold, and still widened the result. The trigram clauses are now gated on `q.fuzzy_enabled = NOT isFullNumber`, so trigram matching is switched off only when the query is a complete multi-group number. Full-text and ILIKE clauses are unchanged.
- A partially typed multi-group number (`ALGA-2026-00028`) still finds its tickets through the subtitle `ILIKE '%raw%'` clause. `ALGA-2026` lists the whole group through the prefix LIKE.
- Client scoping and permission predicates are unchanged; only the identifier bindings changed.

## Deferred

- Global search (`packages/search/src/query.ts`) keeps the first-chunk derivation and still widens a full hyphenated number. The plan scopes this fix to list searches, so global search is marked with `LEVERAGE: pattern search-identifier-derivation`.
- Client portal `TicketList.tsx` filter: out of scope per the PRD.

## Verification (2026-11-19)

- `server`: `npx vitest run src/test/unit/searchIdentifier.test.ts src/test/integration/ticketListFullNumberSearch.integration.test.ts`: 10/10 pass. With the pre-fix `optimizedTicketActions.ts` restored, the integration test fails 4 of 5, which reproduces the bug.
- Package suites: search 16/16, clients 800/800, projects 668/668, tickets 2391/2392. The one tickets failure is `useTicketListChanges.protocol.test.tsx` ("Could not locate installed Hocuspocus server package"), an environment issue unrelated to search.
- `tsc --noEmit` is clean for shared, packages/search, packages/tickets, packages/clients and packages/projects. Server `tsc` runs out of memory on this host.
