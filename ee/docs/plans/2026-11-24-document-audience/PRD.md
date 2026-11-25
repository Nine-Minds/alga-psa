# Document audience

## Problem

A document has one visibility attribute, `is_client_visible`, which can only say whether the client portal may read it. A co-managed workspace has three kinds of reader: MSP staff, the client's seat technicians, and the client's portal users. The boolean cannot describe the middle one.

The seat policy fills the gap with a ticket-only rule: a seat technician reads a document when it is client-visible or attached to a ticket in their scope. That rule produces three defects.

1. A seat technician can upload a document to a task of a shared project and then cannot read it. The create rule admits the upload; the read rule has no ticket to vouch for it.
2. Other seat technicians of the same client cannot read it either.
3. Every MSP document attached to an in-scope ticket is readable by the seat. The MSP has no way to keep one private.

Comments already solved this with a three-value audience (`requester`, `shared_it`, `organization_private`) and one visibility predicate with a TypeScript and an SQL form. Documents should use the same model.

## Goals

- A document carries one audience, with the same values and the same reader rule as a comment.
- MSP staff can attach a document to a ticket or task that seat technicians and portal users cannot read.
- A seat technician's upload is readable by the author, by the other seat technicians of that client, and by MSP staff.
- MSP staff decide the audience of any document and can change it.
- Whatever the seat policy lets a technician create, it lets them read.

## Non-goals

- A fourth audience private to the client's own organization.
- Changing the comment audience model.
- Per-user or per-team document sharing.
- Audit logging, metrics or a feature flag for the change.

## Audience model

| Audience | MSP staff | Seat technicians of the document's client | Client portal |
|---|---|---|---|
| `organization_private` | yes | no | no |
| `shared_it` | yes | yes | no |
| `requester` | yes | yes | yes, subject to the existing portal rules |

Audience is a necessary condition, not a sufficient one. Every existing check still runs: tenant, RBAC, own client, asset readability, comment-attachment audience, meeting admission, bundle narrowing.

### Defaults at creation

| Author | Default | May choose |
|---|---|---|
| MSP staff | `organization_private` | any |
| Seat technician | `shared_it` | `shared_it`, `requester` |
| Portal user | `requester` | `requester` |

An upload into a folder takes the folder's audience when it is wider than the author's default, as client visibility is inherited from a folder today. It is never narrower than the author's floor, so a seat technician cannot create `organization_private` by any path.

### Changing the audience

- MSP staff with `document:update` may set any audience on a document they can read.
- A seat technician chooses the audience at upload only. The seat policy grants no document update, and this plan does not add one.
- A portal user cannot change it.

## Data model

- `documents.audience` and `document_folders.audience`: text, not null, checked against the three values.
- `is_client_visible` stays on both tables as a stored generated column, `audience = 'requester'`. The roughly 70 modules that read it, the bundle constraint `client_visible_only`, the REST and MCP schemas and the portal queries keep working unchanged. Writers move to `audience`.
- Backfill, for both tables: `is_client_visible = true` becomes `requester`; everything else becomes `organization_private`. One exception: a document created by a user who holds a seat assignment becomes `shared_it`, so uploads already lost to this defect reappear for their authors.
- The migration is in `server/migrations`: audience is a base document attribute. `shared_it` is reachable only in a tenant the co-managed capability serves.

Generated columns on distributed tables must be verified against Citus before the migration is written (see the scratchpad). If Citus refuses it, the fallback is a plain boolean maintained by the same write path, with a check constraint tying it to `audience`.

## Authorization

### One audience predicate

`isCommentAudienceVisible` and `commentAudienceVisibleSql` take an audience, an owning tenant and client, and a reader. Nothing in them is specific to comments. They are renamed to a content-audience predicate that comments and documents both call. Comments keep deriving their audience from thread and root; documents read their column.

### Seat policy

```ts
document: { granted: {
  read:   ['own_client', 'shared_audience', 'attached_parents_in_scope'],
  create: ['own_client', 'shared_audience', 'attached_parents_in_scope'],
} },
```

- `shared_audience`: the record's audience is `shared_it` or `requester`. On create it judges the audience the document will be stored with.
- `attached_parents_in_scope` replaces `attached_tickets_in_scope`: every ticket the document is attached to is in the seat's client and boards, and every project task it is attached to belongs to a project shared with the arrangement. Attached to neither is fine.
- `client_visible_or_in_scope_ticket` is removed. It was the stand-in for the missing audience.

Read and create now carry the same conditions, so create cannot admit what read refuses. A contract test holds that for every resource in the seat policy: each condition on `read` is also on `create`.

Both guards have a JS facet and an SQL facet in the record-guard registry, like the guards they replace. The document SQL adapter gains an audience column and an attached-project-task facet.

### Portal

`deniedByClientVisibility` and the portal queries read `audience = 'requester'` through the generated column. No behaviour change.

### Comment attachments

A document owned by a comment keeps following the comment's audience through the existing attachment gate. Its own audience stays `requester`, as its `is_client_visible` is `true` today, so the comment is the only thing that narrows it.

## UX

An MSP with no co-managed seat sees no change. The three-state control is shown only to a tenant that has at least one seat arrangement, in any state. Holding the co-managed capability or a Pro licence is not enough: a tenant that could set up a seat and never has keeps the two-state control.

- A tenant with no seat arrangement keeps today's client-visibility control exactly as it is: same component, same labels, same placement. It writes `organization_private` and `requester`.
- A tenant with a seat arrangement sees a three-state control on the document row, the document drawer, the upload dialog and the folder visibility control: Internal, Shared with client IT, Client-visible. It uses the existing standard select; no new component.
- A seat technician's upload dialog offers Shared with client IT (default) and Client-visible.
- Document lists keep today's client-visible indicator, rendered as it is now, for a tenant with no seat arrangement. A tenant with one sees an audience badge in the same place.
- A document already stored as `shared_it` keeps its audience if the tenant's last arrangement ends; the control returns to two states only when no arrangement row remains.

## API

- Document and folder read models gain `audience`. `is_client_visible` remains, derived.
- Writes accept `audience`. A write that sends only `is_client_visible` maps `true` to `requester` and `false` to the author's default. A write that sends both and disagrees is rejected.
- `toggleDocumentVisibility`, `toggleFolderVisibility` and `toggleFolderVisibilityByPath` become audience setters; the boolean signatures stay as thin callers.

## Edition boundary

The column, the predicate and the two-state control are CE. The three-state control and the `shared_it` value are offered only where the co-managed capability is present. A CE build never writes `shared_it`, and a CE test pins that: the audience setter refuses it, and every CE screen and action works with the two remaining values.

## Risks

- Seat technicians lose access to MSP documents on in-scope tickets that were not client-visible, because those backfill to `organization_private`. This is the chosen default: the seat surface is new, and private-until-shared is the safe direction.
- Citus and generated columns, as above.
- Any writer still setting `is_client_visible` directly fails once the column is generated. That is the intended signal; the feature list covers every writer found.

## Acceptance criteria

1. A seat technician uploads a document to a task of a shared project and to an in-scope ticket. In both cases the author and a second seat technician of the same client see it in the list and can open, preview and download it. MSP staff see it. The portal does not.
2. MSP staff upload a document to the same ticket with the default audience. Neither seat technician can list, open, preview or download it, by any route, including the file-id routes.
3. MSP staff change that document to Shared with client IT: the seat technicians see it. Changed to Client-visible: the portal sees it too. Changed back to Internal: both lose it.
4. A seat technician cannot create or end up with an `organization_private` document through upload, folder inheritance or the API.
5. A tenant with no seat arrangement sees no change in any document screen, including a Pro tenant that holds the co-managed capability. A tenant without the capability cannot store `shared_it`.
6. Existing client-visible documents remain visible to the portal after the migration.
