# Client ticket privacy live verification

## Revision and scope

Application code revision: `75acf2e3556473abedcc1d024ccb657a9dad1d6a` (`fix(client-portal): preserve safe ticket comment deletion`). Verification evidence is committed separately. The pre-existing `package-lock.json` modification remains untouched and unstaged.

No approved plan exists in `git log main..HEAD --name-only -- docs/plans/`. The existing smoke checklist used as the primary spec is `/tmp/alga-smoke-evidence/client-tickets-security-20261103T1610/plan.md`, revision `3d640890b7433ea8a09753b0aba06abc8ecccb09`.

## Environment and identity

The existing registered service `dev-server:3` was resumed with `workflow-ensure-service` on port `3456`; no separate server was launched. The listener's `/proc` cwd resolved to this worktree's `server/`. `server/.env.local` is configured and `server/.env` is absent. The browser signed in at `/auth/client-portal/signin?tenant=6d178745f8f9` using Dorothy Gale's existing portal identity and ordinary permissions. A local password hash was temporarily set to make tenant-scoped credential authentication deterministic, then the saved original hash was restored. No privilege or role changes were made.

## Live checklist results

- **Own retained-comment deletion — passed live and in PostgreSQL.** Dorothy deleted comment `bc934302-b215-4878-b0f9-2d2bf8856b71` on ticket `29930000-0000-4000-8000-0000000000a7` through its portal control. The row is absent; its `email_reply_tokens.comment_id` reference is detached; after refresh the conversation showed five other comments and not the deleted comment. The live action first revealed an FK failure because the client delete path did not detach retained reply tokens. The fix now detaches them before deleting the comment, with a behavioral regression.
- **Create/edit and ownership — passed live.** Dorothy created a public comment, verified its database row and text, edited it, and verified the updated text in PostgreSQL. Temporary comments were then deleted. Dorothy had no edit/delete controls for another author's comment. Replaying the captured update and delete server actions against that public comment returned `Comment not found or not authorized`; the original row remained unchanged.
- **List/detail privacy — passed live.** Actual browser RSC/action responses were inspected after seeding temporary sentinels into ticket attributes, email metadata, and a ticket watcher. The list and detail responses contained none of those sentinels. The list used the client ticket projection; detail comments contained projected portal authors/capabilities, with comment source user/contact/actor UUID fields omitted. After inspection, the sentinels were removed. The detail action also exposed the signed-in user row, including credential hashes; `getCurrentUser` now projects away `hashed_password`, `password`, and `two_factor_secret`, preserving the ordinary session fields. A runtime projection regression covers this behavior.
- **Documents — passed live with and without documents.** With no associated documents the refreshed ticket detail showed “Aucun document trouvé”. For the document-bearing check, temporary public and private ticket documents were associated. The actual detail showed the public probe and did not show the private probe. Both documents and their associations were removed after inspection. No ticket/document fixtures remain.
- **Shared-workspace read-only — passed live with a temporary tenant-local fixture.** The tenant had no pre-existing shared-workspace asset group for Dorothy. A temporary shared asset group was attached to another contact's open ticket on the same client and assigned to Dorothy as an ordinary group contact. On refresh, the ticket appeared in her list and detail, displayed the French read-only notice, and exposed no comment composer. Replaying the captured authenticated `addClientTicketComment` server action against that ticket returned `Ticket introuvable ou accès refusé`; no comment was written. The temporary asset/group/association were deleted, and Dorothy's original password hash was restored and verified byte-for-byte. No roles or privileges changed.

## Executed checks on the application revision

- `packages/client-portal`: `npx vitest run src/actions/client-portal-actions/client-tickets.visibility.test.ts src/components/tickets/TicketDetails.delete.test.tsx` — 39 passed.
- `packages/tickets`: `npx vitest run src/components/ticket/CommentItem.portalOwnership.test.tsx src/lib/commentAuthorResolution.test.ts src/lib/commentVisibility.test.ts` — 30 passed.
- `packages/user-composition`: `npx vitest run src/lib/currentUserProjection.test.ts` — 1 test passed (Vitest ran node and jsdom projects, 2 total tests).
- `packages/client-portal`: `npm run typecheck` — passed.
- `packages/tickets`: `npm run typecheck` — passed.
- `packages/user-composition`: `npx tsc --noEmit -p packages/user-composition/tsconfig.json` — passed; the package has no `typecheck` npm script.
- Root: `npx nx run @alga-psa/client-portal:build` — passed (Nx cache used for 51/51 tasks).
- Root: `npx nx run @alga-psa/tickets:build` — passed (Nx cache used for 29/29 tasks).

The older evidence files `portal-login-email-blocker.txt` and `retained-comment-state.json` are superseded by this run; the former email-discovery failure was not a password-authentication blocker. The incorrect durable blocker fact was retired, and the dossier now records successful tenant-scoped password sign-in.

## Review first

Inspect the comment deletion/token-detachment change and its behavioral regression, then the credential-safe current-user action projection and runtime regression. Review the shared-workspace live read-only evidence and fixture cleanup record along with the two security fixes.

## Current-checkout verification at 08:05 UTC

The checkout was at `dd90969d4023c28d9b79f771610e04dae28dde31`. Its only commits after application revision `75acf2e3556473abedcc1d024ccb657a9dad1d6a` were documentation commits; no application source changed since the live run. At that time, `package-lock.json` and a response-source test fixture update were uncommitted. The following commands passed on that checkout, but the response-source test run depended on the uncommitted fixture update; see the committed rerun below.

- Client portal visibility and deletion UI: 39 tests passed.
- Ticket ownership, author resolution, and comment visibility: 30 tests passed.
- Current-user credential projection: 2 Vitest project runs passed (one behavioral case in each project).
- Client portal and tickets package typechecks passed; user-composition `tsc --noEmit` passed.
- Client portal and tickets Nx builds passed; Nx reused cached outputs for all 51 and 29 tasks respectively.
- `workflow-ensure-service` confirmed registered `dev-server:3` live and healthy. Port 3456 is owned by PID 1417595; `/proc/1417595/cwd` resolves to this checkout's `server/`. Direct unauthenticated `/auth/signin` returned HTTP 307.


No new implementation defect was found. The live ordinary-permission deletion, token detachment, refreshed conversation, payload privacy, document visibility, non-owner denial, and shared-workspace read-only results remain those recorded above at application revision `75acf2e3`; temporary credentials and fixtures were restored. No other workload or reservation was changed.

## Committed response-source fixture rerun

The response-source mock now implements the `whereNull` ownership-query chain used by `addClientTicketComment`. This fixture correction is committed as `d4c9498cd70487e9e449548d0836ab0e45218ff5`. After committing it, the combined response-source, visibility, and deletion UI suites passed on that exact revision: 3 test files, 42 tests. The only remaining working-tree modification is the unrelated, pre-existing `package-lock.json` edit.
