# Recurring Service-Period Explanations

`F266` defines how persisted service-period edits and provenance should surface in client-facing explanations, invoice detail provenance, and support tooling.

## Support Explanation Rule

Support and finance tooling should be able to explain a billed or future period through:

- lifecycle state
- provenance kind and reason code
- source cadence owner and due position
- the active service period and invoice window

This keeps “why did this bill here?” explainable from explicit metadata instead of hidden engine branches.

## Client-Facing Explanation Rule

Client-facing surfaces do not need the full internal audit model, but they should preserve enough additive context to explain:

- whether the line follows the client schedule or contract anniversary
- the billed service period
- whether the final billed timing reflects an edited or deferred period rather than untouched generated cadence

## Deliberate Boundary

This checkpoint still does not define:

- exact client-portal copy for every provenance reason code
- full support-case workflow tooling or timeline UI
- external-system export of every internal provenance field

Those remain sequenced behind `F267-F270`.
