# Contact CSV import tag admission (`8c96987ab5`)

This round follows [7f8ba22461](../7f8ba22461/README.md). The audit of every tag writer found one that was reachable and still unguarded: the contact CSV import (`importContactsFromCSV`, `packages/clients/src/actions/contact-actions/contactActions.tsx`). `/msp/contacts` is an allowed `co_managed` surface. With "update existing", the import deleted a contact's `tag_mappings` directly in its own transaction. Only the re-add went through the guarded `createTag`, and that refusal was swallowed into a warning. A departed customer's import could wipe contact tags and still report the row as updated.

## The fix

- A row that writes tags (update-existing with a `tags` column, or a new tagged row) runs `assertCoManagedOperationalWrite` in the import transaction before the row is written. The refusal comes back as that row's result with the lifecycle message, and neither the contact nor its tags change. Duplicate rows skipped without "update existing" are not admitted and keep their duplicate message.
- The tags are written in the same transaction, inside a savepoint, via `createTagsForEntityWithTransaction`, with tag texts deduplicated. Admission holds `FOR UPDATE` on the sponsor entitlement row until commit. Calling `createTag` on its own connection would therefore wait on the import's own lock for an active co-managed tenant. A variant built that way timed out the active-customer test ([raw-logs/mutation-checks.txt](raw-logs/mutation-checks.txt)).

The rest of the audit found nothing new. The tag server actions, `inboundActions`, REST `TagService`/`ClientService`, the workflow tag actions and `createTicketWithSideEffects` are all admitted. Every other native caller (`clientActions`, the QuickAdd forms, project task import) goes through `createTag`, `createTagsForEntity` or `createTagsForEntityWithTransaction`. `TagManager` is read-only in Entry (`TicketInfo`), Grid (`BentoHero`) and the ticket list (`tagsReadOnly` from `canUpdateTickets`, which includes `workspaceReadOnly`). Management-tenant `TagModel`, `tagCleanup.ts`, entity-delete cascades and the client merge engine stay out of scope.

## Tests

| Check | Result | Log |
| --- | --- | --- |
| `coManagedBootstrap` `-t 'tag lifecycle'` | 12 passed | [raw-logs/integration-tag-lifecycle.txt](raw-logs/integration-tag-lifecycle.txt) |
| `coManagedBootstrap` full file | 1481 passed (1478 at `4ea4664182` + 3 new) | [raw-logs/integration-full-file.txt](raw-logs/integration-full-file.txt) |
| Admission removed / pre-fix source / own-connection variant | red / red / active control hangs | [raw-logs/mutation-checks.txt](raw-logs/mutation-checks.txt) |
| Contact CSV contract tests, `ticketTags.readOnly`, `ticket-columns.tagsReadOnly` | 16 passed | [raw-logs/unit-and-ui.txt](raw-logs/unit-and-ui.txt) |
| `server` `tsc --noEmit` | exit 0 | [raw-logs/typecheck-server.txt](raw-logs/typecheck-server.txt) |
| `packages/clients` `tsc --noEmit` | 1 error, in untouched `clientMergeEngine.test.ts`, also present at `4ea4664182` | [raw-logs/typecheck-clients.txt](raw-logs/typecheck-clients.txt) |

## Live check on the served build

`review-build-prep-8c96987a` built `8c96987ab5…+da39a3ee5e6b` into `server/.next-review-final-8c96987a` (prepare-only, result 0). `review-app:23` now serves `build-1792978025330` on :23374, and `/api/health` returns 200 ([runtime-provenance.json](runtime-provenance.json), [board-admission-attempts.txt](board-admission-attempts.txt)). The journey is in [05-contact-csv-tag-write](05-contact-csv-tag-write/summary.json), with the combined receipt in [05-contact-csv-tag-write/db-receipt.json](05-contact-csv-tag-write/db-receipt.json).

- **Terminated customer** (`admin@kansasfarms.test`, tenant `3261f313`, relationship `ad0808b5` terminated before and after). Entry, Grid and the ticket list show the `Barn network` tag with no add or remove control. Through the served build's real action IDs:
  - `createTag`, `updateTagColor`, `updateTagText`, `deleteTag` and `deleteAllTagsByText` are each refused with the read-only message.
  - `importContactsFromCSV` refuses both an update-existing row with tags (Dorothy Gale) and a new tagged row.
  - `contacts`, `tag_definitions` and `tag_mappings` for the tenant are byte-identical afterwards.
- **Active co-managed control** (`alice@whiterabbit.test`). A ticket tag is added and removed through the Entry layout. A CSV import sets a tag on Alice Liddell and a second import clears it. Both rows succeed, so the import does not wait on its own admission lock. The definition is then removed and the contact fields are unchanged. The first attempt failed at login with a superseded shared password ([raw-logs/live-run-1.txt](raw-logs/live-run-1.txt)). The re-run used the reprovisioned active-admin credential ([raw-logs/live-run-2-active-control.txt](raw-logs/live-run-2-active-control.txt)).
- **Native Oz control** (`qa@emeraldcity.oz`). Same steps on Dorothy Gale (`dorothy@oz.com`), all passed.

Screenshots are committed. Walkthrough videos (`*.webm`) are kept locally, as in earlier rounds.
