# Investigation and handoff

QuickAddTicket uses the tickets package's searchClientsForPicker. Both that action and the clients package's equivalent use createClientScopeContext. The shared picker applies the supplied predicate before counting, paging and resolving selected IDs.

In the committed implementation, createClientScopeContext returns an unrestricted context when the tenant has no published bundle assignments. It also returns unrestricted when no bundle rule matches the resource and read action. Both decisions can miss the built-in seat resolver. The requester's actual bundle configuration is unknown.

Relevant files include packages/authorization/src/clientScopeAuthorization.ts, packages/authorization/src/readScope.ts, packages/co-managed/src/seatAuthority.ts, shared/ticketClients/clientPicker.ts and server/src/test/integration/searchClientsForPicker.integration.test.ts.

An uncommitted exploratory change used the existing read-scope evaluator across client and contact reads. The authorization package suite passed, but the new integration case stopped before its assertions because its hosted sponsor fixture lacked the Pro plan. Seed an eligible sponsor and verify the actual picker result. The shared checkout has unrelated edits. Use the card worktree and treat the draft as investigation only.

## Implementation notes (Draft Implementation)

- Fix lives in the scoping layer: `createClientScopeContext` now delegates to `resolveNarrowedReadScope` / `applyReadScope` (`readScope.ts`), so the built-in seat resolver and bundle rules compile into one SQL predicate. The no-bundle and no-matching-rule early returns are gone.
- `resolveNarrowedReadScope` gained an optional `resolveSubject` supplier so client and contact scopes share one request-local subject, loaded lazily (never on the fast path).
- The tenant probe still runs once, at context creation, and is cached on the request cache; a tenant with no published assignment and no seat subjects stays at that single statement.
- Behavioural difference to know about: a closed bundle that does not name `client`/`contact` read now denies (kernel semantics) where the old context left it unnarrowed.
- Regression: `server/src/test/integration/searchClientsForPicker.seatScope.integration.test.ts` (10 of 17 failed before the fix; all pass after). Sponsor fixture needs `tenants.plan = 'pro'`, `product_code = 'psa'` and a hosted `co_managed_entitlements` row.
