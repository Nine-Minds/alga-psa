# Investigation

The seat role grants `project_task:update`. In the sponsoring MSP workspace, the seat project surface closes `project_manage`. The writable fields in `packages/projects/src/lib/projectSurface.ts` omit tags, and `TaskForm.tsx` disables the tag picker even with eligible tags. The separately hosted cross-tenant shared-project screen uses its own data source.

Inspect `packages/tags/src/actions/tagActions.ts` and the last-use removal flow in `TagManager.tsx`. A tag mapping belongs to a record. Its definition belongs to the MSP and can outlive the last mapping. Verify the seat can detach an MSP-applied tag where it can update the record.

## Implementation notes (alga-2026-0003430)

- Server (`packages/tags/src/lib/tagWriteScope.ts`, used by `tagActions.ts`): `createTag`, `deleteTag` and `bulkApplyTagsToEntities` ask the kernel
  (only for a subject a built-in resolver governs, so MSP tagging is unchanged) whether the caller may update the target ticket
  (`authorizeTicketRecordAccess`) or project task (`assertWorkItemParentAllowed`, resolver `tagged_entity`). `createTag` and bulk apply also
  require the existing definition to be visible under `resolveTagReadScope`.
- Definition management (`updateTag`, `updateTagColor`, `updateTagText`, `deleteAllTagsByText`, `deleteTag(id, true)`) asks the resolver's closed
  baseline (`isResolverGovernedActionAllowed`, new, generalizes `isResolverGovernedCreateAllowed`); a seat holds `tag:read` only there, though its
  role holds `tag:update`. Before this, a seat could rename/recolor definitions and the last-use dialog could delete one.
- Detaching an MSP-applied mapping: `deleteTag` required `tag:delete` for mappings created by someone else. A governed caller whose record write was
  verified skips that rule (the record scope governs); everyone else keeps it.
- `checkTagPermissions` gains `canDeleteDefinition`; `TagManager` skips the last-use "delete definition" prompt when it is false and accepts
  `emptyChoicesMessage`. `MANAGE_CLOSED_WRITABLE_TASK_FIELDS` (and the server list) now include `tags`; `TaskForm` passes `readOnly={frozen('tags')}`.
- A definition with no mapping left is not visible to a seat (tag read scope is via mappings), so after the last use is removed only MSP can re-apply it.
- Tests: `server/src/test/integration/coManagedSeatTags.db.test.ts` (T001/T002), `packages/projects/.../TaskFormTags.test.tsx` (T003).
