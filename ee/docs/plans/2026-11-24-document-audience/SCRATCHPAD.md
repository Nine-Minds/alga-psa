# Scratchpad: document audience

## How the defect was found

A seat technician can upload a document and then not read it. Traced from code on 2026-11-24; not reproduced against a running stack.

- Seat policy: `packages/co-managed/src/seatAuthority.ts`, `SEAT_AUTHORITY_POLICY.document`. Read carries `client_visible_or_in_scope_ticket`; create does not.
- Guards: `packages/authorization/src/kernel/recordGuards.ts`.
- Record check and SQL adapter: `shared/lib/documentAuthorization.ts` (`resolveDocumentAuthorizationRecords`, `createDocumentRelationshipSqlAdapter`).
- Upload sets visibility in `packages/documents/src/lib/createDocumentFromCommittedFile.ts`: an internal uploader's document is client-visible only when the target folder is.
- `packages/co-managed/src/__tests__/seatAuthority.test.ts` ("the named cases") pins the denial of a non-visible document with no attached ticket as intended. That assertion changes with this plan.

The task case is certain from the policy. The ticket case is not explained: a Documents-section upload on an in-scope ticket should pass all three read conditions. Untested candidates: the comment-attachment gate (`canReadCommentAttachment` in `shared/lib/ticketCommentAttachments.ts`), an upload made before any association exists, a ticket with no board.

## Decisions (Robert, 2026-11-24)

1. Existing documents default to `organization_private`. The seat surface is new, so nothing needs preserving.
2. A seat technician may publish to `requester`, matching comments.
3. Folders carry the same audience (left to the implementer; chosen so folder inheritance has one rule).

Made while drafting, open to challenge:

- A seat technician picks the audience at upload only. The seat policy grants no document update and the closed baseline denies it; widening that is a separate decision.
- `is_client_visible` stays as a derived column so its ~70 readers and the `client_visible_only` bundle constraint are untouched.
- Seat-authored documents backfill to `shared_it` so already-lost uploads reappear.
- No fourth audience private to the client's organization.

## Existing model to reuse

`shared/lib/commentAudience.ts`: `COMMENT_AUDIENCES`, `isCommentAudienceVisible`, `commentAudienceVisibleSql`, `audiencesVisibleTo`. Reader kinds are `requester`, `seat`, `staff`. The seat branch already requires the owner client to match the reader's client.

## To verify before writing the migration

- Stored generated columns on a distributed table in the Citus version production runs. Use the `alga-regression-citus` container. Related gotchas are in the `citus-migration-gotchas` skill.
- Whether `document_folders` and `documents` are both distributed, and whether adding a check constraint needs the stale-local-heap truncation first.

## Survey commands

```bash
grep -rlE "is_client_visible|isClientVisible" packages server/src shared ee/server/src ee/packages --include="*.ts" --include="*.tsx" | grep -v node_modules
grep -rn "client_visible_only" packages shared server/src --include="*.ts" | grep -v node_modules
```

Writers are concentrated in `packages/documents`, `shared/services/email`, `packages/telephony`, `packages/assets`, `packages/billing`, `server/src/lib/api/services`.
