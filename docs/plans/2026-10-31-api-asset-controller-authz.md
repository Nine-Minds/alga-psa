# Plan — API-key callers can read/modify/delete assets with no asset permission

**Finding (confirmed in code at HEAD of the card worktree).** `withApiKeyRouteAuth` only authenticates the key and
installs tenant/user context (`server/src/lib/api/middleware/withApiKeyRouteAuth.ts`, `apiAuthMiddleware.ts:98-116`).
`ApiAssetController.requireAllowedContext` (`server/src/lib/api/controllers/ApiAssetController.ts:40-54`) then checks
*product* access only. Consequence: every one of the v1 asset endpoints reaches `AssetService` with no `asset:*`
check — `list` (56), `getById` (92), `create` (112), `update` (133), `delete` (154), `listRelationships` (165),
`listTickets` (244), `createRelationship` (301), `deleteRelationship` (319), `listDocuments` (330),
`associateDocument` (341), `removeDocumentAssociation` (359), `listMaintenanceSchedules` (370), plus
`bulkUpdate`, `bulkStatusUpdate`, `export`, `search`, `getStatistics` behind the same controller.

**The half-built state on main.** `requireReadPermissions` (205) and `requirePermissions` (224) already exist and are
called by exactly four methods (`listAssignments` 180, `listStatuses` 195, `linkTicket` 264, `unlinkTicket` 287).
The defect is not missing machinery — it is that authorization is *opt-in per method*, so twelve methods simply
forgot. That is the shape to fix, not each call site.

## Design: one action-aware entry point, no context without a decision

Replace the two parallel helpers and `requireAllowedContext` with a single method:

```ts
type AssetAction = { resource: 'asset' | 'ticket'; action: 'read' | 'create' | 'update' | 'delete' };
private async authorize(req: NextRequest, checks: AssetAction[]):
  Promise<{ context: ApiContext; denied: NextResponse | null }>
```

It runs, in order: request context → product-access behaviour (today's `requireAllowedContext` body, unchanged) →
`hasPermission` for each check on the tenant connection. Every public method starts with

```ts
const { context, denied } = await this.authorize(req, ASSET_READ);
if (denied) return denied;
```

and **`context` exists only as a return value of `authorize`** — the old `requireAllowedContext` is deleted, so
there is no way to obtain a usable context and skip the check. Adding a method without a requirement becomes a
compile error rather than a silent hole. One declarative table of requirement constants (`ASSET_READ`,
`ASSET_CREATE`, `ASSET_UPDATE`, `ASSET_DELETE`, `ASSET_UPDATE_TICKET_UPDATE`) keeps the per-method line to one.

## Requirement map (all v1 asset routes; every one of them lands on this controller)

| Route / method | Requirement |
| --- | --- |
| `list`, `getById`, `search`, `export`, `getStatistics`, `{id}/relationships`, `{id}/documents`, `{id}/maintenance-schedules` | `asset:read` |
| `{id}/tickets`, `{id}/assignments`, `{id}/statuses` | `asset:read` + `ticket:read` |
| `create` | `asset:create` |
| `update`, `bulkUpdate`, `bulkStatusUpdate` | `asset:update` |
| `delete` | `asset:delete` |
| `linkTicket`, `unlinkTicket` | `asset:update` + (on ticket mutation) `ticket:update` |
| `createRelationship`, `deleteRelationship` | `asset:update` + `asset:read` on the related asset |
| `associateDocument`, `removeDocumentAssociation` | `asset:update` |

## Record-level, and the association-ID hole

Coarse permission is necessary but not sufficient: the finding asks for record-level authorization on item and
association routes. Two rules:

1. **Tenant scope is resolved before authorization, and a miss is 404, not 403** — an attacker must not learn that
   an id exists elsewhere. For association-ID routes (`deleteRelationship`, `removeDocumentAssociation`) the
   handler must first load the association and its asset *inside the caller's tenant*, then run the requirement
   against that asset. Today those routes act on the association id alone (`:319`, `:359`).
2. **Client-scoped assets** must be filtered by the same ACL predicate the UI path uses (the shared
   `hasPermission`-driven client-scope rule in `server/src/lib/auth/rbac`), applied inside the query — not by adding
   a second, hand-written rule in the controller. If `AssetService` already accepts a user/ACL argument, pass the
   authenticated user through; if not, that is the one service-level change this design makes, so list/search/
   export/statistics cannot drift apart.

## Tests (regression first)

New `server/src/lib/api/controllers/ApiAssetController.authz.test.ts`, table-driven over **every** public method:
- user with no asset permissions → 403 on each read and each mutation;
- `asset:read` only → reads 200, every mutation 403;
- `asset:update` → update/bulk/relationship/document/association mutations 200, `delete` 403;
- `asset:delete` → delete 200;
- an association id belonging to another tenant → 404 before any write.
The suite must fail on today's HEAD (that is its point) and the fixture user must be a real API-key context, not a
mocked `hasPermission` — the global rbac mock in `server/src/test/setup.ts` must be opted out for this file.

## Deliberately not doing

- Not touching `withApiKeyRouteAuth`: authentication is correct; the gap is authorization.
- No new permission scopes or role-seed changes — `asset:read/create/update/delete` and `ticket:*` already exist.
- No UI changes; no change to `AssetService` business logic beyond accepting a caller for ACL filtering.

## Risks

- Some internal integrations may hold API keys whose user lacks `asset:*`; they will start getting 403. That is the
  finding's intent, but the smoke test should exercise the documented API-key flows so a legitimate regression is
  visible rather than silently shipped.
- `hasPermission` adds one query per check; the endpoints already do a product lookup, and the helper caches per
  request if we pass the same knex — verify cost in the smoke run rather than guessing.

## Implementation order

1. **Tests first.** Add `ApiAssetController.authz.test.ts` with the table from *Tests* above and opt it out of the
   global rbac mock (`server/src/test/setup.ts`) so `hasPermission` is real. Confirm it fails on current HEAD
   (12 unguarded methods should let an unprivileged key through).
2. **The entry point.** Introduce `authorize(req, checks)`; move the product-access body of
   `requireAllowedContext` into it; delete `requireAllowedContext`, `requireReadPermissions` and
   `requirePermissions`; convert the four already-guarded methods (`listAssignments`, `listStatuses`,
   `linkTicket`, `unlinkTicket`) to the new signature.
3. **Mechanical sweep.** Convert every remaining public method to `const { context, denied } = await
   this.authorize(req, <REQUIREMENT>); if (denied) return denied;` following the requirement map. The suite from
   step 1 is the acceptance gate; no method may reach `assetService` without it.
4. **Association-ID routes.** Resolve association → asset within the tenant in `deleteRelationship` and
   `removeDocumentAssociation`, 404 on a tenant miss *before* the authorization call.
5. **Client-scope filtering.** Thread the authenticated user into the list/search/export/statistics queries so the
   shared rbac client-scope predicate applies inside SQL. One helper in `AssetService`, not four copies.
6. Verify: the authz suite green, `npm run test -- server/src/lib/api` green, tsc clean.

## Out of scope / do not touch

- `withApiKeyRouteAuth` and `apiAuthMiddleware` (authentication is correct).
- Permission scope definitions and role seeds.
- Any UI work.
