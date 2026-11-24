# Design — Workflow actions that add and remove real ticket tags

Card: `Workflow actions can add and remove real ticket tags` (eebec2a1) · customer ask from
Coastline Tech Services (alga-2026-0003286) · target: hosted Pro.

## Problem

A `ticket.created` workflow cannot tag the ticket it is handling.

- `tickets.create` applies **real** tags: `shared/services/tickets/createTicketWithSideEffects.ts:329`
  calls `TagModel.getOrCreateTagDefinition(text, 'ticket', tenant, trx)` then `TagModel.createTagMapping`,
  i.e. `tag_definitions` + `tag_mappings`, the same tables the UI reads.
- `tickets.update_fields` accepts `patch.tags` and writes them **only** into `tickets.attributes`
  (`businessOperations/tickets.ts:860`, returned at 886/968/983). Nothing reaches `tag_mappings`, so the
  ticket never shows a tag. The field's name promises tags and delivers JSON, which is what the customer hit.

There is already a general tag primitive in the shared layer (`shared/models/tagModel.ts`:
`getOrCreateTagDefinition`, `createTagMapping`, `deleteTagMapping`, `tagExistsForEntity`, `getTagsByEntity`),
and the server-side `TagService` exposes the same operations for every taggable entity
(`tagEntity`, `untagEntity`, `replaceEntityTags`; `shared/interfaces/tag.interfaces.ts` defines
`TaggedEntityType = 'client' | 'contact' | 'ticket' | 'project_task' | 'document' | 'knowledge_base_article' | 'opportunity'`).

## Decision

Two new workflow actions that work on **any** taggable entity, plus a fix to the misleading update field.

1. **`tags.add`** — `entity_type` (the `TaggedEntityType` union), `entity_id`, `tags: string[]`.
   Idempotent: a missing definition is created, an existing mapping is left alone.
2. **`tags.remove`** — same inputs; deletes the mapping for each tag text that exists, ignores the rest.
   Removal never deletes a tag definition (other entities may still use it).
3. **`tickets.update_fields.patch.tags`** becomes a *replace* of the ticket's real tag mappings and stops
   writing `attributes.tags`. Replace, because `patch` already means "set these fields".

`tickets.create.tags` keeps its current behaviour (real tags, mirrored into attributes) — changing a
shipped create path is not needed to satisfy the ask.

Why actions instead of extending `update_fields` alone: the customer's own read is right — tagging is not a
ticket-specific concept, clients already read `tag_mappings`, and a second entity will want it next week.
Two small actions over one pure helper is the general mechanism; `update_fields` is then just another caller.

## Changes

**`shared/services/tags/applyTagChanges.ts` (new)** — the only place that writes tag rows for workflows:

- `addTagsToEntity(trx, tenant, { entityType, entityId, tags, actorUserId? })`
  → normalise (trim/lowercase, dedupe, drop empties) → for each, `TagModel.getOrCreateTagDefinition` →
  `TagModel.createTagMapping` only if `tagExistsForEntity` is false. Returns `{ added, skipped }`.
- `removeTagsFromEntity(trx, tenant, { entityType, entityId, tags })`
  → resolve definitions by text for that entity type, `deleteTagMapping` each mapping that exists.
  Returns `{ removed, missing }`.
- `replaceTagsOnEntity(trx, tenant, { entityType, entityId, tags })` = remove-all-current + add.
- Both take the caller's transaction (the workflow action's tx) — no nested `withTransaction`, no new
  connection, mirroring `createTicketWithSideEffects`.
- Definition colours come from the existing `generateEntityColor` path inside `TagModel`, so workflow-created
  tags look like UI-created ones.

**`shared/workflow/runtime/actions/businessOperations/tags.ts` (new)** — `registerTagActions(registry)`
registering `tags.add` and `tags.remove` at version 1 with picker metadata (`category: 'Tags'`), Zod inputs,
and a handler that opens the tenant transaction and calls the helper. Entity existence is checked before
writing (`tickets`, `clients`, `contacts`, `project_tasks`, `documents`, `knowledge_base_articles`,
`opportunities` — one small map), so a bad `entity_id` fails the action with `NOT_FOUND` instead of
creating orphan mappings. The action result returns the resulting tag texts and the `{added, skipped}` /
`{removed, missing}` counts so the workflow can branch.

**`shared/workflow/runtime/actions/businessOperations/tickets.ts`** — in `tickets.update_fields`:
`patch.tags` calls `replaceTagsOnEntity`; delete the `mergedAttributes.tags = input.patch.tags` write and
update the field description to "Replaces the ticket's real tags (tag_definitions/tag_mappings)". The
`tickets.create` path is untouched.

**Registration** — add `registerTagActions` next to the other business-operation registrars so the actions
appear in the workflow picker and the generated action catalog.

## Tests

- `tags.add`: creates definition + mapping for a ticket; second identical call is a no-op (`skipped`);
  creates for a client (proves entity generality); unknown `entity_id` fails `NOT_FOUND`.
- `tags.remove`: removes one of two tags, leaves the other; removing a tag that is not mapped is a no-op;
  the definition survives.
- `tickets.update_fields` with `patch.tags`: ticket shows the new tags, `attributes.tags` is no longer
  written, replacing with `[]` clears mappings.
- Existing `tickets.create` tag tests stay green (no behaviour change).
- Run: `npx vitest run shared/workflow/runtime/actions/__tests__/tags*.test.ts` from `server/`, plus the
  existing ticket action suites.

## Risks and non-goals

- **Hosted Pro**: the helper uses only tenant-scoped tables already used by `tickets.create`; nothing
  server-local. The integration test must run under the tenant-scoped DB to prove it.
- **Permission model**: workflow actions do not carry a user's tag permission; they run as the workflow's
  tenant authority, exactly as `tickets.create` does today. Entity permission checks are not in scope here.
- **Attributes**: tickets already carrying `attributes.tags` from the old write are left alone; we stop
  writing new ones but do not migrate history.
- **Not in scope**: UI tag management, tag colour editing, bulk tagging across entities, tag deletion
  garbage collection.
