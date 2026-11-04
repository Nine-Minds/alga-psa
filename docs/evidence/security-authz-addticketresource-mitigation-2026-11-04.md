# Security authorization mitigation run — 2026-11-04

Revision exercised: `b3611c905a0d2fe4d56ec35f22fef44825faa6a8`.

There is no plan under `docs/plans/` in `main..HEAD`; this run followed the
external evidence dossier at `/tmp/alga-smoke-evidence/security-authz-addticketresource-20261104/plan.md`.

## Server admission and readiness

Requested the existing board-managed `dev-server` with
`alga-dev workflow-ensure-service --projectId=b187efd9-44d1-5c65-ac0c-f5764e43191f --name=dev-server`
and no command override. It returned `created:false`, session
`card-service:b187efd9-44d1-5c65-ac0c-f5764e43191f:dev-server:11`, saved cwd
`/home/robert/alga-copies/feature-security-authz-in-addticketresource/server`,
and saved command `PORT=3751 npm run dev`. `GET
http://feature-security-authz-in-addticketresource.localhost:3751/auth/signin`
returned HTTP 307 to `/auth/msp/signin`; following the redirect returned HTTP
200 with the MSP sign-in document. The board's last service snapshot at
2026-11-04T03:59:17.479Z showed the same service `live`, with no launch queue.

The board CLI browser listing timed out once. A card-space browser tab was
opened and navigated to the same origin. The canonical QA account
`qa@emeraldcity.oz` authenticated and reached `/msp/dashboard`; `/msp/tickets`
rendered the ticket list. The Add Ticket and global Quick Create controls were
clicked, but neither produced a creation dialog. A later HTTP probe followed
the initial 307 but timed out waiting for the redirected response. No separate
server or origin was used.

## Authorization scenarios

Not completed. No assignment or removal was attempted, no inaccessible-ticket
principal/fixture was exercised, no retained assignment ID was replayed, no
mutation before/after database state was captured, and no ticket with
additional agents was created. This run is not live authorization acceptance
and gives no record-level authorization verdict. The baseline 42/42 focused
assignment/human-work regressions and tickets package typecheck are prior-run
results; this mitigation made no code changes and ran neither check.

No authorization code was changed. The worktree contains only this evidence
record. The `security-finding-resolved` executable is unavailable in PATH;
no verification was started or recorded, and no passing verdict is claimed.

External run artifacts and captured responses are under
`/tmp/security-authz-addticketresource-20261104-*` and
`/tmp/alga-smoke-evidence/security-authz-addticketresource-20261104/`.
