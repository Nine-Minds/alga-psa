# Co-managed task status audit redaction

PSA: `alga-2026-0003079`

## Finding

Task status is stored as `project_status_mapping_id`, while readers can redact any of its display/source aliases. The audit history projects `changed_data` through `CO_MANAGED_AUDIT_DERIVED_ALIASES`; because the mapping field was absent there, a status alias redaction still returned both old and new mapping UUIDs. Task editing separately carried an incomplete list of status aliases.

## Design

Use `CO_MANAGED_STORED_FIELD_ALIASES` in `sharedWorkProjection.ts` as the sole registry for stored fields with related display/source aliases. Map `project_status_mapping_id` to `status`, `status_name`, `status_id`, `selectedStatus`, `statuses`, `standard_statuses`, `custom_name`, and `project_status_mappings`. Keep the existing `msp_assignee` mapping in this registry. Make `CO_MANAGED_AUDIT_DERIVED_ALIASES` refer to this registry and have task editing consult it rather than maintaining another status alias list.

## Verification

Exercise `listCoManagedProjectTaskHistory` with a real `project_status_mapping_id` change for every listed redaction alias and assert the change and mapping UUIDs are absent. Retain an unredacted control proving the legitimate status audit entry is visible.
