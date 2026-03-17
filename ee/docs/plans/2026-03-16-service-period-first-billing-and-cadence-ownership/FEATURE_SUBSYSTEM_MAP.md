# Feature-To-Subsystem Map

## Purpose

Use this file to keep implementation progress traceable by subsystem instead of only by chronological feature order.

The feature list is intentionally long because the billing cutover spans runtime, persistence, read models, authoring, downstream consumers, rollout, and the later materialized-service-period ledger. This map is the index for that breadth.

## Tracking Discipline

When completing work from `features.json`:

1. identify the primary subsystem from the map below
2. note any secondary subsystem surfaces touched by the same checkpoint
3. update `SCRATCHPAD.md` with the concrete files and behavior changes
4. keep commit messages scoped to the feature ID or the coherent subsystem slice being advanced

When adding new features:

1. place the new feature inside the correct subsystem band
2. update this map if the feature introduces a new subsystem or a new cross-cut seam
3. avoid creating feature IDs whose subsystem ownership is ambiguous from the artifact set

## Subsystem Bands

| Subsystem | Primary feature bands | What lives here |
| --- | --- | --- |
| Architecture, inventory, and parity scaffolding | `F001-F010`, `F111-F120`, `F147-F150` | pass-0 inventory, parity harness, rollout staging, follow-on boundaries, operator/runbook artifacts |
| Shared recurring timing domain | `F011-F020` | canonical service-period types, invoice-window types, cadence owners, due-position and coverage helpers |
| Client-cadence generation and parity engine | `F021-F040` | anchored client periods, partial-period rules, first/final period semantics, zero-coverage behavior |
| Runtime recurring charge execution | `F041-F070`, `F143-F146`, `F256-F266` | fixed/product/license timing, bucket timing, canonical runtime guardrails, eventual persisted-service-period runtime consumption |
| Invoice generation, persistence, and recurring billing runs | `F071-F080`, `F151-F190`, `F241-F242` | due selection, preview/generate flows, duplicate prevention, billed-through, recurring execution identity, grouping rules, financial artifact semantics |
| Data model, repositories, APIs, and recurrence storage reconciliation | `F081-F090`, `F201-F230`, `F243-F255` | cadence-owner persistence, compatibility readers/writers, repository cleanup, authoring-path storage normalization, regeneration and override policy |
| Authoring UI and recurring configuration surfaces | `F091-F097`, `F121-F124`, `F138-F145`, `F202-F210`, `F250-F258`, `F264-F266` | contract-line configuration, wizards, templates, presets, dashboard copy, portal detail policy, future service-period inspection/editing surfaces |
| Reporting, portal readers, and accounting/export consumers | `F098-F100`, `F125-F133`, `F191-F200`, `F222`, `F225-F227` | invoice readers, portal billing views, report date-basis policy, export adapters, projection-mismatch diagnosis |
| Contract cadence and mixed-cadence behavior | `F101-F110`, `F156-F160`, `F223` | anniversary-based service periods, mixed-window grouping, contract-cadence due selection, contract-cadence scheduler cutover |
| Materialized service-period ledger | `F231-F270` | persisted service-period schema, lifecycle state, provenance, generation, regeneration, editing, invoice linkage, repair flows |

## Cross-Cut Seams To Recheck During Every Pass

- Runtime plus persistence: canonical recurring periods are only done when invoice detail writes and rereads stay coherent.
- Reader plus export surfaces: any header-versus-detail semantic change must be checked in dashboard, portal, and export consumers.
- Authoring plus storage: cadence-owner or timing defaults are only safe when wizard, template, preset, custom-line, repository, and API paths agree.
- Rollout plus cleanup: staged compatibility work must stay explicit until source and DB validation prove the legacy seam is actually dead.

## Minimum Coverage Expectation

Before declaring the plan complete, the implemented feature set must still be traceable across all of these surfaces:

- runtime billing and timing domain
- invoice generation and persistence
- credits, prepayment, and negative-invoice flows
- repositories, APIs, and recurrence storage
- dashboard, wizard, template, and preset authoring
- client portal, reporting, and accounting exports
- rollout, cleanup, validation, and operator runbooks
- persisted service-period ledger design and lifecycle
