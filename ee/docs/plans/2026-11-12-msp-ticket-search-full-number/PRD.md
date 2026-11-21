# MSP ticket search: a full ticket number returns only that ticket

## Problem

Searching the MSP ticket list for a full ticket number returns many tickets when the number has more than one dash-separated group (for example a tenant prefix plus the optional date prefix: `ALGA-2026-0002826`).

`optimizedTicketActions.ts` extracts a "ticket identifier" from the query with `/\b[A-Z]+-?\d+\b/` (`TICKET_LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN`). For `ALGA-2026-0002826` that captures only `alga-2026`. The search then ORs in `metadata->>'identifier' LIKE 'alga-2026%'`, which matches every ticket in that prefix and year. The index stores the full `ticket_number` as `metadata.identifier` (`packages/search/src/indexers/ticket.ts`), so the exact-match clause would have worked had it been given the whole number.

## Goal

A query that is a full ticket number returns exactly that ticket first and does not widen to the tickets sharing its prefix. Other searches (title, client, partial text) behave as before.

## Requirements

- Compare the identifier against the whole trimmed query, case-insensitively, for the exact-match clause.
- Keep the starts-with identifier match only where the query is a single number-shaped token with no further hyphenated groups, so `TIC0002826` style numbers and genuine partial numbers still work.
- A query pasted with a leading `#` or surrounding whitespace is cleaned before the identifier is derived.
- Do not touch the full-text, trigram or title/subtitle clauses.
- The same fix applies to any other list that shares the identifier derivation (check `shared/ticketClients/listSearchSql.ts` and the client list search).

## Out of scope

The client portal ticket list filter (`packages/client-portal/.../TicketList.tsx`) is a separate client-side substring match and is tracked separately.

## Acceptance

Searching `ALGA-2026-0002826` in the MSP ticket list shows that ticket and not the other 2026 tickets; searching `#ALGA-2026-0002826` and `ALGA-2026-0002826 ` give the same result; searching `ALGA-2026` still lists the 2026 tickets.

## Implementation notes

- Shared helper: `shared/ticketClients/searchIdentifier.ts` (`deriveSearchIdentifierMatch` → `exact`, `prefix`, `isFullNumber`).
- The identifier fix alone was not enough: the index subtitle is `client · ticket_number`, so trigram similarity (`subtitle % raw`, ~0.5) still matched sibling numbers. The fuzzy trigram clauses are now gated by `q.fuzzy_enabled`, which is false only for a complete multi-group number (`^[A-Z]+(-\d+){2,}$`).
- Global search (`packages/search/src/query.ts`) is unchanged and carries a `LEVERAGE: pattern search-identifier-derivation` marker.
