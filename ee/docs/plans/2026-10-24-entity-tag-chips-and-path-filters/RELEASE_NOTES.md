# Release note: VIP and POC are now tags, shown as chips

The VIP and primary-contact flags proposed in PR #3858 are replaced by ordinary contact and client
tags plus **tag display rules**, which decide which tags appear as badges next to a name.

**What changes for you**
- **No data migration for the flags.** They were never released. New tenants start with a "VIP" contact tag and a
  "VIP" client tag, each with an internal display rule. Existing tenants whose contact or client tag definition is
  already named "VIP" (any case) get an internal display rule from the migration.
- **Where tags show.** Ticket list rows (Contact and Client columns, Contact is now visible by default), the ticket
  header and properties panel, and the contact and client pickers render the displayed tags as badges.
- **Settings > Tags** manages display rules per entity type and audience. An audience with no rules sees no tags, so
  client-portal users see nothing until a client rule is added. Writing rules needs `settings:update`.
- **New ticket-list filters.** "Requester tags" and "Client tags" filter by any-of / none-of. A ticket with no client
  matches a none-of client filter.
- **Saved views.** Named views, board defaults and tenant defaults are upgraded on read to the new format. Old
  tag-text filters become tag ids; views that used the VIP filters lose those clauses. Filters that reference a deleted
  tag are dropped with a notice.
- **URLs.** The `where` parameter carries path filters, for example `where=v1:contact.tags:in:<tagId>`. Old links keep
  working.
- Every ticket-list filter now runs through one shared compiler (`@alga-psa/predicates`); results are unchanged.

**Needs a browser check:** badge rendering on rows/header/pickers and the filter toolbar flow.
