# Release note: recurring tickets use ticket templates

Recurring tickets now take their content from a ticket template instead of carrying their own copy. Existing
schedules were migrated automatically: each got its own template, marked "Scheduled only" so it does not appear in the
new-ticket picker.

**What changes for you**
- **Checklists are now snapshots (R6).** A migrated schedule's checklist is copied into its template. Later edits to the
  original checklist template no longer change what a schedule creates; edit the ticket template's checklist instead.
- **Template edits apply to the next ticket (R2).** Several schedules can share one template; changing it changes all of
  them from their next occurrence on. Editing template content needs `ticket_template:update`; schedule, dispatch
  (status, assignment) and per-schedule overrides stay under `recurring_ticket:update`, so Dispatchers keep control of
  when and for whom without being able to change shared content.
- A template used by an active or paused schedule cannot be deleted. Deactivating it only hides it from the picker; its
  schedules keep running.
- Generated tickets now show "From template" next to the "Recurring" badge.
