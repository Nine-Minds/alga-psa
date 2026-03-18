# Recurring Service-Period Administrative Repair

`F259` defines the first operator-facing repair and administrative regeneration flows for persisted service periods when future ledger rows are missing, drifted, or incorrectly linked.

## Supported Administrative Repair Modes

The first planned operator flows are:

- restore missing future generated rows
- realign future untouched generated rows to current source cadence
- repair incorrect invoice linkage on locked or billed rows

These are intentionally narrower than everyday billing-staff edits:

- boundary adjustment, skip, and defer remain normal future-row edit flows
- administrative repair is for ledger drift, failed generation, or incorrect billed-history linkage

## Safety Rules

Administrative repair must keep the earlier lifecycle and provenance rules intact:

- billed history stays immutable except for the already-named corrective flow `invoice_linkage_repair`
- edited, locked, and billed rows are preserved unless an explicitly designed corrective flow says otherwise
- regeneration of untouched future generated rows still uses the existing regeneration/conflict contract
- missing future periods are restored as generated rows; they do not rewrite historical invoices

## Diagnosis To Repair Mapping

The first repair mapping is:

- missing future coverage -> restore missing generated rows ahead of the horizon boundary
- stale untouched generated rows after source-rule changes -> run administrative regeneration with the same preservation/conflict rules as ordinary regeneration
- broken billed-history linkage -> use `invoice_linkage_repair` instead of schedule regeneration

This keeps schedule drift, missing future coverage, and billed-history linkage problems from collapsing into one vague “repair” concept.

## Deliberate Boundary

This checkpoint still does not define:

- a concrete admin UI or bulk-import surface
- automatic repair retries that run without operator review
- historical invoice rehydration or replay of old recurring runs

Those remain sequenced behind `F267-F269`.
