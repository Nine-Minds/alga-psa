# TagManager reconciliation after Contacts CSV import (`7e137086e6`)

## Defect

A Contacts CSV re-import wrote the correct tags, but each row's TagManager kept showing the old chip until the page was reloaded. The cause was an effect keyed on `initialTags.length`. It ignored an empty list whenever chips were already shown, and it never fired for a same-length replacement (A → B). See the smoke finding in `/tmp/alga-smoke-evidence/co-managed-it-20261026-0238` (not committed).

## Fix (`7e137086e6`)

`packages/tags/src/components/useReconciledTags.ts` computes the displayed tags as the authoritative base plus this TagManager's pending add/remove operations.

- **Base:** replaced whenever `initialTags` changes by content signature: sorted id, text and colours, including an empty list. A new array with the same content does not trigger a reset.
- **Pending operations:** held in a ref and reapplied on every new base. The marker clears when the server action settles. On success the operation is folded into the base; on failure or a throw it is dropped.
- **TagManager:**
  - Add shows a provisional chip until `createTag` settles.
  - Remove hides the chip until `deleteTag` settles.
  - Text and colour edits apply to the base.
  - The TagContext sync now writes through `commitBase` so a later settle cannot undo it. Its trigger is unchanged.
- **Contacts.tsx:** no change. After import, the `[contacts]` effect already re-reads `findTagsByEntityIds`, and the rows already pass the refreshed `initialTags`.

## Tests and typechecks ([logs/](logs/))

| Check | Result | Log |
| --- | --- | --- |
| `packages/tags` vitest, including `TagManager.reconcile.test.tsx` (7 cases) | 17/17 passed | [tags-vitest.log](logs/tags-vitest.log) |
| `packages/clients` contacts and CSV lib tests, including `Contacts.importTags.test.tsx` (2 cases) | 73/73 passed | [clients-contacts-vitest.log](logs/clients-contacts-vitest.log) |
| Contact CSV unit and integration tests (throwaway `TEST_DB_NAME`/`DB_NAME_SERVER=tagmgr_csv_throwaway`) | 14/14 passed | [contact-csv-unit-integration.log](logs/contact-csv-unit-integration.log) |
| `packages/tags` `tsc --noEmit` | exit 0 | [tsc-tags.log](logs/tsc-tags.log) |
| server `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit` | exit 0 | [tsc-server.log](logs/tsc-server.log) |
| Mutation checks | see below | [mutation-checks.txt](logs/mutation-checks.txt) |

Mutation results:

- Restoring the old length-keyed effect turns 4/7 TagManager tests and 2/2 Contacts import tests red.
- Not reapplying pending operations turns 3 red.
- Keying on array identity turns the same-content test red.
- Not clearing the pending marker on failure turns both revert tests red.

## Production build and board admission

- The fix is `7e137086e6`. The served source is `54e75edfab`, the evidence-only commit directly after it, built as `build-1792983401994` in `server/.next-review-final-54e75edf`. See [runtime-provenance.json](runtime-provenance.json).
- The build was a board-admitted prepare-only service, `review-build-prep-54e75edf`, using the registered launcher. It typechecked, ran `next build` and returned 0 ([prepare-54e75edf.sh](prepare-54e75edf.sh)).
- Promotion steps:
  1. Concluded the old `review-app:23`, which was serving `8c96987a`.
  2. Sent SIGTERM to its orphaned `next-server` after the conclude.
  3. Ensured `review-app:25` with readiness on `23374/api/health`, and the board admitted it.
- Health is 200, and the sign-in HTML carries the build ID ([board-admission-attempts.txt](board-admission-attempts.txt)).
- The board marked `review-app:25` as suspended 3 s after creation because the current step does not use it. The supervised process keeps serving, as in the `8c96987a` round. `workflow-ensure-service` emitted no numeric admission ledger.
- **Workers:** not rebuilt. No file they compile changed, and their dists contain no TagManager code.

## Live re-proof on the production build ([live/](live/), [summary](live/summary.json))

Every case used the real Contacts → Upload CSV dialog with columns `full_name,email,tags`, update-existing confirmed, through isolated Playwright (`/usr/bin/google-chrome`) at `http://feature-co-managed-it.localhost:23374`.

- Each writable case checks four things after every import:
  - PostgreSQL `contacts` and `tag_mappings` rows ([db-receipt.json](live/native-oz/db-receipt.json)).
  - The row's chips in the list, with no reload. The document's `performance.timeOrigin` is unchanged.
  - The contact is listed once.
  - A later reload agrees.
- Each case has a WebM, per-step screenshots and DOM captures.

| Case | Actor | Flow | Result |
| --- | --- | --- | --- |
| Native Oz | `qa@emeraldcity.oz` | A → blank: chip clears; [] → A; A → B: chip shows B; reload agrees; restore blank | passed, 27 assertions ([native-oz](live/native-oz/)) |
| Active White Rabbit | `alice@whiterabbit.test` | same | passed, 27 assertions ([active-white-rabbit](live/active-white-rabbit/)) |
| Terminated Kansas Farms | `admin@kansasfarms.test` | blank-tags update of Dorothy Gale with a changed name | refused with the read-only message; `contacts`/`tag_definitions`/`tag_mappings` byte-identical; relationship still terminated; name unchanged after reload ([terminated-customer](live/terminated-customer/)) |

The live script is [live/scripts/tagmanager-live.cjs](live/scripts/tagmanager-live.cjs). Earlier harness attempts are kept in [live/attempts/](live/attempts/):

1. A strict-mode row locator matched the hidden printable table.
2. The script waited for a close button that the success path never shows, because Contacts closes the dialog itself.
3. A same-document check ran after a deliberate reload.

None of these was a product failure. In attempt 2 the chip had already updated without a reload ([failure.png](live/attempts/native-oz-2/failure.png)).

**Data:** these runs reused the two smoke contacts from the previous round (`csv.native.0238@example.test`, `csv.active.0238@example.test`), and each run ends with its tags cleared. Import-created `TM-A …`/`TM-B …` tag definitions remain as normal product history. Kansas Farms is unchanged.
