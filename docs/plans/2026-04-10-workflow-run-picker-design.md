# Workflow Run Dialog Picker Design

## Goal
Make the Workflow Run dialog use system pickers for supported event/payload schema fields without creating a second picker system that drifts from the workflow properties dialog.

## Design

### Shared concept
Reuse the existing workflow schema editor / picker contract already used by the properties dialog:
- `x-workflow-editor.kind = "picker"`
- legacy `x-workflow-picker-kind`

The run dialog should consume that same contract instead of introducing run-dialog-only picker metadata.

### Shared implementation direction
- Extract shared schema-to-editor metadata resolution into a reusable helper.
- Reuse the shared picker renderer layer from `WorkflowActionInputFixedPicker` for run-dialog fields.
- Add ticket search support into that shared picker layer so `ticketId` can use a first-class system picker too.

### Fallback policy
For near-term usefulness, allow a narrow fallback inference layer in the run dialog for well-known fields when schemas are not yet annotated:
- `ticketId` -> ticket picker
- `actorContactId`, `contactId` -> contact picker
- `createdByUserId`, `actorUserId` -> user picker
- `clientId` -> client picker

This fallback should stay intentionally small. The preferred long-term path is adding schema annotations at the source.

### Guardrails
- Selected picker values still serialize as plain literal IDs in the payload.
- Unsupported picker metadata should fall back to generic controls.
- Strategic code comments should point future work toward schema annotations and shared picker extension points rather than adding more ad hoc run-dialog logic.
