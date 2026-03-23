# Follow-on Boundary — Richer Service-Period Editing

## Boundary

Recurring v1 supports only the narrow future-edit surface already defined elsewhere:

- `boundary_adjustment`
- `skip`
- `defer`

Anything broader stays out of scope until the first materialized-ledger rollout is proven stable.

## Explicitly Deferred Editing Work

- split one future period into multiple billable periods
- merge adjacent future periods into one new period
- bulk or mass editing across many obligations at once
- schedule transforms driven by offsets or cadence-conversion rules
- multi-window edit workflows that move several future periods in one action

## Why This Is Deferred

Richer editing would need new answers for:

- revision lineage across multiple replacement rows
- continuity validation across more than one adjacent period
- grouping and due-selection semantics when one action affects multiple invoice windows
- provenance and explanation when one edit mutates several future periods

## Trigger To Reopen

Reopen this follow-on only if v1 proves insufficient, for example:

- operators repeatedly need split or merge to model the signed agreement
- support teams cannot correct future schedules with the v1 surface plus repair flows
- repetitive manual edits justify mass-edit tooling

## Constraint On Future Work

Any richer editing plan must keep the v1 guarantees intact:

- billed rows stay corrective-only
- provenance stays explicit on every new revision
- due selection remains explainable when edits move work across invoice windows
