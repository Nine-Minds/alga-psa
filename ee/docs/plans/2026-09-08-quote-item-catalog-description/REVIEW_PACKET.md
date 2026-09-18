# Ticket 2354 Design Review Packet

## Asked

Plan a complete, code-grounded fix so quote output can show the product/service name above its catalog description while retaining the separately editable line description and historical quote stability.

## Done

- Created the synchronized ALGA plan in this directory.
- Traced catalog selection, quote-item persistence/update, duplicate/revision/template copying, view-model adapters, field registration, standard/grouped templates, AST validation/editor round-trip, and client/server renderers.
- Chose an additive nullable `catalog_description` snapshot, server-authoritative capture for new catalog selections, exact preservation through copy flows, and no historical backfill.
- Chose a backward-compatible optional stacked-lines table-cell AST so item name and catalog description can have independent styling while old single-value columns remain unchanged.

## Verified

- Plan validator passed: 18 atomic features and 10 Pareto-focused tests.
- `git diff --check` passed for the plan directory.
- Source inspection confirmed the picker, draft creation, and `QuoteItem.create` currently omit catalog description.
- Source inspection confirmed preview/PDF use `mapQuoteItemToViewModel`, quote designer fields omit the required distinct fields, and current table columns/renderers support only one expression/style per cell.
- Source inspection confirmed duplication, revision, save-as-template, and create-from-template have explicit item-copy paths that must preserve snapshots.

## Unsure

- Implementation should choose the smallest additive AST representation that cleanly round-trips through `workspaceAst.ts`; required semantics are fixed, but the internal property name is not.
- Managed seeded standard templates may require a data migration keyed to known standard-template identities; customer-owned custom ASTs must not be rewritten.
- The worktree already has an unrelated modified root `package-lock.json`; it must remain outside this work.

## Recommendation

Advance to Draft Implementation. Compatibility and snapshot policies are resolved, the impacted modules and order of work are explicit, and remaining choices are implementation details covered by behavioral tests.
