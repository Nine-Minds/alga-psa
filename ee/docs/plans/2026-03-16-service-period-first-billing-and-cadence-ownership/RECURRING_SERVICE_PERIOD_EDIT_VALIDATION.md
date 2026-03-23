# Recurring Service-Period Edit Validation

`F248` defines the first neighbor-aware validation rule for future persisted service-period edits.

## Continuity Rule

User edits are validated against adjacent active rows on the same `scheduleKey`.

The v1 rule is intentionally simple and explicit:

- the edited row must remain contiguous with the immediately previous active service period
- the edited row must remain contiguous with the immediately next active service period
- continuity is evaluated on canonical `servicePeriod` bounds, not invoice headers

`shared/billingClients/recurringServicePeriodEditValidation.ts` now makes that executable.

## Rejected States

The helper rejects four continuity failures with clear messages:

- gap before the edited period
- overlap before the edited period
- gap after the edited period
- overlap after the edited period

The boundary-adjustment and skip/defer helpers now call the same validator when sibling schedule rows are supplied.

## Deliberate Boundary

This checkpoint still does not define:

- UI transport of sibling context
- cross-schedule conflict handling when source-rule regeneration collides with edited rows
- split / merge continuity semantics

Those remain sequenced behind `F249-F251`.
