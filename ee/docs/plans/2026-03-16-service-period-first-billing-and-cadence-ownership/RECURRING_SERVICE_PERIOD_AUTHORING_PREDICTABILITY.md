# Recurring Service-Period Authoring Predictability

`F264` defines how future service-period editing interacts with templates, presets, and new recurring-line authoring so the generated schedule stays understandable after creation.

## Source Versus Future Override Rule

Templates, presets, and authoring defaults define the initial source cadence only.

After a live recurring line exists:

- future persisted service-period edits belong to that live line
- template or preset changes do not retroactively rewrite those future edits
- new lines created from the same preset or template get a fresh generated schedule from the current authoring defaults

## Predictability Rule

The first predictability rule is:

- authoring inputs explain the initial future schedule
- later persisted-period edits explain exceptions on that live schedule
- source defaults remain reusable for new lines without becoming hidden mutation channels for existing lines

## Deliberate Boundary

This checkpoint still does not define:

- cloning or copying live service-period overrides back into presets or templates
- mass propagation of one repaired live schedule to other contracts
- pre-save preview persistence beyond the existing illustrative preview contract

Those remain sequenced behind `F267-F270`.
