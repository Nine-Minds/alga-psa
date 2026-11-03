# REST project read redaction design

## Problem
`authorizeApiResourceRead` currently discards authorization `redactedFields`, so REST project reads can expose fields that policy allows the caller to know about only in redacted form. Derived statistics and exports can also reveal values sourced from hidden fields.

## Design
- Return the kernel decision as `{ allowed, redactedFields }` from the shared API authorization helper.
- Use one `projectRecord(record, redactedFields)` projector for REST project get, list, search, export, and statistics inputs.
- Match both canonical field aliases and source dependencies for derived fields such as client and status names.
- Use the co-managed relation-aware field and whole-resource hiding primitives. Omit a project when the resource or its identifier is hidden.
- Keep list pagination authorization-aware and project the allowed row before serialization. Export JSON/CSV and statistics consume projected rows only; omit aggregate outputs whose source fields are hidden.
- Preserve unrestricted behavior and denied-read behavior.

## Verification
Behavioral tests cover field and relation redactions, aliases, derived dependencies, row suppression, REST serialization paths, unrestricted reads, and denied reads. Run focused unit tests and the server typecheck without starting the app server.
