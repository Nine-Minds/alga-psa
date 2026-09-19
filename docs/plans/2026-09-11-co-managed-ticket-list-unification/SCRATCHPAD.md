# Co-managed ticket list unification: working notes

## Scope and decisions

- Plan the accepted scope-switch direction against the existing ticket application. The prototype supplies interaction decisions, not a replacement application shell or a reduced native ticket feature set.
- Follow the worktree's `docs/plans/` convention alongside the original co-managed plan and the client-integration follow-on.
- Planning only. Implementation and test checklist entries remain incomplete until supported by code and execution evidence.

## Initial source anchors

- `server/src/app/msp/tickets/page.tsx`: native server-rendered list, URL filter parsing, page-size preference, remembered board and board/tenant default resolution, plus a separate co-managed queue link.
- `packages/tickets/src/components/TicketingDashboardContainer.tsx`: native data and metadata fetching, URL synchronization, request-generation guards, and resolved view state.
- `packages/tickets/src/components/TicketingDashboard.tsx`: the actual board/filter/table/selection/share/view surface.
- `packages/tickets/src/components/TicketViewMenu.tsx`: appearance and administrative defaults, not arbitrary personal named saved queries.
- `packages/co-managed/src/ticketQueue.ts`: qualified combined relation; working and oversight; client/workspace filtering; supported search/sorts/state; counts and full filtered export.
- `server/src/components/co-managed/CoManagedTicketQueue.tsx`: separate queue UI and client-scoped queue reuse.

## Related plans

- [Co-managed foundation](../2026-09-06-co-managed-it-plan.md)
- [Client integration](../2026-09-11-co-managed-client-integration/PRD.md)
- [Shared work audit](../co-managed-audit-t08-t15.md)

## Grounding discoveries

- The running Next process was matched to this worktree and inspected at `/msp/tickets`. The real screen was opened in the supplied browser pane. Filters, View and Share were expanded without submitting a data mutation.
- The real list already uses adaptive DataTable column fitting and a hidden-column/Show all notice. The static candidates' crushed title column was not evidence of the same defect in the application.
- Native search genuinely searches ticket/comment index entries and handles bundled-child matches. The qualified reader supports title/number only. The UI must vary search semantics by source rather than changing native search.
- Native creation is `/msp/create-ticket` through `buildCreateTicketHref`, not an inline form. Native list detail is routed with `returnFilters`; the separate client list uses a drawer. The prototype's preview is not a new feature requirement.
- Share currently offers Print, Print options, selected CSV export and Import CSV. CSV is disabled without native selection. Qualified full-result CSV is a separate action with a different selection contract.
- Native View captures allowed filters as well as presentation. `captureTicketViewSettings` uses a deny-list, so appending queue scope to native filter types without exclusion could save scope for everyone.
- `TicketsRouteProvider` has a local-ID session-storage contract consumed by bulk modal routes. Qualified selection must stay separate; changing only a table row key is insufficient.
- `ticket-columns.tsx` hard-codes native title and number Link hrefs, including modified-click behavior. Updating only the dashboard's row-click callback is insufficient.
- `CoManagedTicketQueueItem` omits assignment presence. Its existing query already computes assignment visibility and uses references for working membership. Add a redaction-aware optional boolean, not user-directory enrichment.
- The current workspace options subquery reads `authorized`, while client-filtered records use `filtered`. Client-scoped workspace options need explicit query correction rather than page-based filtering.
- Existing export errors clear rows/counts, and the unit test deliberately asserts that behavior after lost authority. The prototype's retain-rows-on-any-error state cannot be copied safely with the current throwing action contract.
- `DataTableProps` has no auto-fit override. A small additive auto/scroll mode can preserve native auto-hiding while keeping qualified identity/responsibility reachable.
- Shared bulk handback validates each resource/revision and reuses per-item operation receipts. Recovery means retrying the exact command; no separate outcome-query endpoint currently exists.

## Plan decisions

- Scope estimate: 39 features and 20 representative tests across five milestones. Existing functionality is recorded as an integration/regression obligation, not a claim that it must be rebuilt.
- Preserve native bare-route/remembered-board behavior by default. Explicit co-managed links open combined working. The PRD calls out changing the bare default as a review decision because the mockup default differs.
- Keep one visible list, a shared presentational frame and two isolated source controllers. Avoid casting qualified records to native records or building a universal replacement engine.
- Keep shared control scope narrower than native: title/number search, client/workspace/state, supported sort, CSV and handback. No unimplemented board/tag/assignee/SLA filtering in the combined reader.
- Reuse the existing client feature slot, routed creation and qualified detail routes. Do not introduce another application shell, standalone list page or personal saved-view subsystem.
- Inherit original T21/T22 because UI is being relocated. No backend release-flag checks or new operational monitoring project.
- No schema migration is planned for assignment-presence and workspace-option projections. Real migrated DB happy/guard evidence remains required.

## Additional source anchors

- `packages/tickets/src/lib/boardTabs.ts`: tab/filter equivalence, pinned/transient boards, remembered-board and URL precedence.
- `packages/tickets/src/lib/ticketViewSettings.ts`: board > tenant > catalog resolution, capture exclusions, stored-filter validation.
- `packages/tickets/src/lib/ticket-columns.tsx`: native Link hrefs, native metadata, response-state and merged Due/SLA rendering.
- `packages/tickets/src/lib/createTicketRoute.ts`: routed create prefill contract.
- `packages/tickets/src/components/TicketsRouteProvider.tsx` and `server/src/app/msp/tickets/layout.tsx`: native selection persistence/modal composition.
- `packages/ui/src/components/DataTable.tsx`, `dataTableColumnFit.ts`, and `packages/types/src/interfaces/dataTable.interfaces.ts`: fitting, sizing and caller contract.
- `packages/co-managed/src/ticketBulkHandback.ts`: batch size, exact identity/revision checks, per-item outcomes and unexpected-error propagation.
- `server/src/lib/actions/coManagedTicketQueueActions.ts`: browser actor binding and stable qualified CSV columns.
- `server/src/components/co-managed/CoManagedClientIntegration.tsx`: current client Tickets replacement slot.
- `packages/msp-composition/src/clients/MspClientTickets.tsx`: ordinary native client cursor list and drawer flow.

## Verification commands and evidence

Planning validation:

```bash
python3 /home/robert/.agents/skills/alga-plan/scripts/validate_plan.py docs/plans/2026-09-11-co-managed-ticket-list-unification
git diff --check -- docs/plans/2026-09-11-co-managed-ticket-list-unification
```

Future focused commands, run from the corresponding package directories after implementation:

```bash
# packages/tickets
npm run typecheck
npm test -- src/lib/boardTabs.test.ts src/lib/ticketViewSettings.test.ts src/lib/ticketListUrlSync.test.ts src/components/TicketingDashboardContainer.urlSync.contract.test.tsx src/components/__tests__/TicketsRouteProvider.selectionPersistence.test.tsx src/lib/__tests__/ticketColumns.prefetch.contract.test.ts

# packages/co-managed
npm run typecheck

# server, with the established isolated test DB configuration
npx vitest run src/test/unit/product/coManagedTicketQueue.test.tsx src/test/unit/product/coManagedTicketQueueActions.test.ts src/test/unit/product/coManagedTicketBulkHandback.test.tsx
```

The database harness `ee/temporal-workflows/src/__tests__/integration/coManagedBootstrap.integration.test.ts` clones schema into a disposable database and installs the co-managed migration set. Extend its relevant query/handback cases; do not run new fixtures against application tenant data. Load the integration-testing workflow before implementation of database tests.

Existing native screenshot is a temporary local artifact at `/tmp/ghostty-pane-ide/screenshots/co-managed-existing-ticket-list.png`. It contains development fixture context and is not copied into the plan. The durable baseline is described in the PRD.

Only plan validation and baseline screen inspection belong to this planning pass. Application tests, migrations and feature acceptance remain unexecuted until implementation.

## Planning validation result

- ALGA plan validator passed: 39 feature entries and 20 test entries.
- Additional consistency audit passed: unique feature/test IDs, valid PRD section references, every feature mapped to at least one test, and all implementation flags false.
- All 24 explicitly named source-file anchors and related-plan links checked by the audit exist.
- Whitespace checks passed for all four new plan artifacts, including their untracked contents.
- The final scope review made reload recovery explicit in both the PRD and F030/T013 and replaced a prototype-only preview reference with the actual composer/navigation contract.
