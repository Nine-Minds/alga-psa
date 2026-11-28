# Client portal ticket search: a pasted ticket number finds the ticket

## Problem

The client portal ticket list (`packages/client-portal/src/components/tickets/TicketList.tsx`) filters the loaded tickets in the browser with a lowercase substring match of the raw search text against `title`, `ticket_number`, `status_name` and `priority_name`. The text is not trimmed or cleaned.

Ticket notification emails show the number as `Ticket #<number>` (for example `Ticket #ALGA-2026-0002826`). A client who copies the number from the email pastes a leading `#`, often a leading or trailing space, and sometimes the word `Ticket`. None of those appear in the stored `ticket_number`, so the search returns nothing. Typing only the trailing digits works, which is the workaround customers use today.

Reported by CloudVBS on PSA ticket alga-2026-0002826.

## Goal

Searching the client portal ticket list with a ticket number as it appears in our emails, or as a client is likely to type it, shows that ticket. Searching by title, status or priority behaves as before.

## Requirements

- Trim the search text before matching.
- When the text is a ticket reference, strip a leading `#` and a leading `Ticket` / `Ticket #` (case-insensitive) before matching against `ticket_number`.
- Match ticket numbers without regard to separators: `ALGA-2026-0002826`, `alga 2026 0002826` and `ALGA20260002826` all find the ticket. Compare the query and `ticket_number` with hyphens and spaces removed, for the ticket number field only.
- Title, status and priority keep their current substring match on the trimmed text.
- Put the ticket-reference normalisation in a shared, pure helper that the MSP ticket search can also use. The MSP card (plan `2026-11-12-msp-ticket-search-full-number`, XO card 60496638) needs the same `#` and whitespace cleaning; if it has already landed a helper on main, reuse it instead of adding a second one.

## Out of scope

- The MSP ticket list search and its identifier extraction (tracked on the MSP card).
- Moving the portal search to the server. The portal still filters the tickets it has loaded.

## Acceptance

In the client portal ticket list, each of `ALGA-2026-0002826`, `#ALGA-2026-0002826`, ` #ALGA-2026-0002826 `, `Ticket #ALGA-2026-0002826` and `alga20260002826` shows ticket ALGA-2026-0002826. `2826` still finds it. Searching part of a title still works, including with surrounding spaces.
