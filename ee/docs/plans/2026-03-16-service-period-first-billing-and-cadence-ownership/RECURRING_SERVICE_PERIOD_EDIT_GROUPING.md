# Recurring Service-Period Edit Grouping

`F265` defines how due selection and invoice grouping respond when a future persisted service-period edit moves work across invoice windows.

## Active Invoice-Window Rule

Due selection uses the active persisted row’s `invoiceWindow`, not the source rule’s old window.

That means:

- an edited row leaving its original invoice window is no longer selected there
- the moved row becomes due on the edited invoice window instead
- superseded rows do not keep the original window alive for due selection

## Grouping Rule After Edits

Once a moved row becomes due on its edited window:

- grouping starts from the edited invoice-window identity
- other normal split constraints still apply after that window match
- cadence owner alone still does not force a split if the edited row now lands on the same invoice window as other due work and no stricter split rule applies

## Deliberate Boundary

This checkpoint still does not define:

- a UI that previews regrouping impact before the edit is submitted
- automatic reconciliation for already-issued invoices if an operator edits a not-yet-billed future row later
- DB-backed selection tests for every edited-window regrouping case

Those remain sequenced behind `F267-F270`.
