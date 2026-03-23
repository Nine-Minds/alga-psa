# Recurring Service-Period Bucket Semantics

`F262` defines how recurring bucket or allowance semantics behave when future persisted service periods are edited, skipped, or regenerated.

## Shared Period Boundary Rule

Recurring bucket and allowance behavior follows the active persisted service period for the bucket-backed obligation:

- included allowance belongs to the active service period boundary
- overage evaluation belongs to the invoice window for that same active period
- rollover rules continue to look at consecutive active periods on the same schedule

## Edit And Skip Effects

The first edit rules are:

- boundary adjustments move the allowance boundary with the edited active period
- skip removes that future allowance period from ordinary due selection instead of creating a hidden zero-allowance phantom period
- defer moves the due invoice window for the edited period; it does not invent a second allowance period for the same coverage

## Regeneration Rule

Untouched generated bucket periods may still regenerate with the normal preservation rules, but:

- edited bucket periods remain preserved
- skipped bucket periods remain preserved
- conflicts between regenerated source cadence and preserved overrides follow the same explicit conflict surface as other recurring families

## Deliberate Boundary

This checkpoint still does not define:

- non-recurring bucket reporting metrics
- time-entry or usage-event bucket projection onto the persisted recurring ledger
- mass bucket rebalancing after bulk schedule edits

Those remain sequenced behind `F267-F270`.
