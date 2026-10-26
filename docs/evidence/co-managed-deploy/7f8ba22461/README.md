# Ended-customer tag writes on the served build, after re-provisioning the review environment

This packet closes the live half of the tag lifecycle round. [6555ef31ff](../6555ef31ff/README.md) guarded the remaining workflow and ticket-creation tag writers, but its live check could not run: the review database `server_co_managed` had been emptied at 23:28Z by a DB-backed test harness. This round rebuilt that database and the review scenario through the product, rebuilt the review app at the current head through the board, and ran the step-2 scenario against it.

## What runs where

| | |
| --- | --- |
| Application source | `7f8ba224614469791df901bd7bd37b0eba3649da`, diff fingerprint `da39a3ee5e6b` (clean tree). The product code is `6555ef31ff`; the later commit is evidence only. |
| Build | `build-1792973888001` in `server/.next-review-final-7f8ba224` |
| Origin | `http://feature-co-managed-it.localhost:23374` (production). The sign-in HTML carries the build ID and `/api/health` returns 200 ([runtime-provenance.json](runtime-provenance.json)). Every scenario rechecks both before it starts. |
| Build service | `review-build-prep-7f8ba224:21`, prepare-only, admitted normally and concluded after the build ([script](prepare-7f8ba224.sh), [log](review-build-prep-7f8ba224.txt)) |
| Serving service | `review-app:22`, admitted normally with readiness `23374/api/health`. It reused the stamped build ([start log](review-app-22-start.txt), [board calls](board-admission-attempts.txt)). |
| Replaced | `ccb29f50` / `build-1792967039963`. It was concluded through the board (`review-app:21`) and stopped with `run-card-service.sh review-app --stop`. The card-owned `next-server` it left listening was then sent SIGTERM. |
| Database | `server_co_managed` on `co-managed-it-postgres` (127.0.0.1:5376), re-provisioned at 23:50Z |

## Re-provisioned environment

**Database.** `server_co_managed` was recreated empty, `app_user` was granted the database and the `public` schema, and then two steps ran from `server/`:

- `npm run migrate:ee` applied 1240 CE+EE migrations ([log](../reprovision-20261025/raw-logs/migrate-ee.txt)). `stripe_subscriptions`, `scim_connections`, 29 `co_management_*` and 15 `co_managed_*` tables are present.
- `knex seed:run --env development` ran the 89 dev seeds as `app_user` ([log](../reprovision-20261025/raw-logs/dev-seeds.txt)).

The seeded sponsor Oz is a new tenant. The old ids cannot come back.

**Stripe simulator.** The card's simulator (control `:9175`) still held subscriptions tagged with the old Oz tenant. It was reset, then re-seeded through its control API the same way it was on 2026-10-13: config, `price_cm_review_1149`, `price_cm_review_pro`, customer `cus_oz_review` / `oz@example.com`, and an active Pro subscription tagged with the new Oz tenant. Webhooks go to `:3374` and `:23374`.

The simulator implements neither `products.retrieve` nor `expand`. The app's first-contact customer import therefore fails on `importSubscription`, but only after it has imported the customer row. Later previews and purchases read that row and work.

**Review scenario, built through the product.** Every business record came from the UI on the card's dev server (`:3374`). [Scripts](../reprovision-20261025/scripts/); recordings and screenshots per [stage](../reprovision-20261025/stages/).

1. **Oz admin** ([a](../reprovision-20261025/stages/a-oz-admin/recording.json)). Glinda's empty seeded hash was initialized on dev-server boot from a privately configured `DEV_LOGIN_PASSWORD`, the documented banner method. Glinda then created `qa@emeraldcity.oz` as an Oz Admin through Settings > Users.
2. **Seat pool** ([b](../reprovision-20261025/stages/b-seat-pool/recording.json)). QA bought 3 seats in Co-managed IT. Checkout `cs_5315c42a5` was completed with the simulator's `complete-session` action, because embedded Stripe.js rejects emulator sessions. The signed webhook then set capacity to 3.
3. **Two customers** ([active](../reprovision-20261025/stages/c-provision-active/recording.json), [departing](../reprovision-20261025/stages/c-provision-departing/recording.json)). QA provisioned each workspace with one seat. Each invited administrator set a password from the invitation delivered to the SMTP sink, accepted the relationship, completed workspace setup, and created a native ticket by Quick Add. The departing administrator then added the tag "Barn network" through the ticket screen.
4. **Native ticket and departure** ([d](../reprovision-20261025/stages/d-native-and-departure/recording.json)). QA created a native Oz ticket and then ended the Kansas Farms relationship from `/msp/co-management/departure` (End co-management).

No raw SQL wrote business state. SQL was used only to read ids and to verify results.

**New ids.** Passwords stay in `card-review-private/co-managed-it-3363`.

| | Tenant | Relationship | Admin | Ticket |
| --- | --- | --- | --- | --- |
| Oz (sponsor, psa/pro) | `fa7f912f-6b62-463e-85cc-ffedab47ac44` | | `qa@emeraldcity.oz` (`86952555-610c-4737-be41-a9236cfa9cdb`) | `14619f1e-dd21-4f7e-902f-32fb983766df` (native) |
| White Rabbit IT (active) | `c64b2666-7dd6-4c61-8ced-4b233f628e61` | `2be5cb32-91e8-491a-9ec4-16ab019c7d40` | `alice@whiterabbit.test` | `cbe64b12-08a7-4b31-b9b9-01afe26094e5` |
| Kansas Farms IT (terminated) | `3261f313-8e04-45df-94bc-0343e92ba454` | `ad0808b5-25df-4e95-987a-aa650c8ba24f`, ended 2026-10-26T00:13:30Z | `admin@kansasfarms.test` | `0a767ca1-0f61-4817-a1af-e8d4183ff402`, tag "Barn network" |

These ids are recorded as workflow facts. The 36 facts that cited the old tenants, relationships and tickets are retired: `24ac76c8`, `1f98df77`, `d46de2e8`, `38db9e8a`, `cfff4242`, `68a51c93`, `c7c64319` and the older fixture ids.

## Step 2 on the served build

All three scenarios passed ([summary](04-ended-tag-write/summary.json), [combined receipt](04-ended-tag-write/db-receipt.json)).

**Terminated customer** ([recording](04-ended-tag-write/terminated-customer/recording.json), [video](04-ended-tag-write/terminated-customer/walkthrough.webm), [db-receipt](04-ended-tag-write/terminated-customer/db-receipt.json)). The actor is the Kansas Farms IT administrator.

- **Entry and Grid.** Ticket `0a767ca1` shows "Barn network" in both layouts with 0 tag add, inline-add or remove controls ([Entry](04-ended-tag-write/terminated-customer/entry-tags.png), [Grid](04-ended-tag-write/terminated-customer/grid-tags.png)).
- **Ticket list.** `/msp/tickets` shows 0 tag controls ([screenshot](04-ended-tag-write/terminated-customer/ticket-list.png)).
- **Direct writes.** Seven tag server actions were POSTed from the customer's own session, bypassing the UI. Their ids came from this build's `server-reference-manifest.json`; the calls were `createTag` (new text and the existing text), `updateTagColor`, `updateTagText`, `deleteTag`, `deleteAllTagsByText` and `createTagsForEntity`. Each was refused with "This co-managed workspace is read-only…". The bulk helper, which swallows per-tag failures, returned `[]` ([responses](04-ended-tag-write/terminated-customer/direct-server-action-writes.json)).
- **Database.** `tag_definitions` and `tag_mappings` for the tenant are byte-identical before and after (1 and 1). The relationship is still `terminated` with the same `ended_at`.

**Positive controls** ([active](04-ended-tag-write/active-customer-control/recording.json), [native](04-ended-tag-write/native-oz-control/recording.json)). Alice on White Rabbit IT ticket `cbe64b12`, and QA on native Oz ticket `14619f1e`, each:

- added a tag through the ticket screen;
- saw it persist across a reload;
- removed it with "Remove & Delete Definition".

Both tenants' tag tables match their starting state ([active receipt](04-ended-tag-write/active-customer-control/db-receipt.json), [native receipt](04-ended-tag-write/native-oz-control/db-receipt.json)).

**REST: not attempted live.** The terminated workspace has no API key, and creating one was not attempted. The REST `TagService` and `ClientService` refusals are proven by the PostgreSQL tests in [tagfix-ccb29f50](../tagfix-ccb29f50/README.md).

## Test databases

The DB-backed workflow-action suites and `createTestDbConnection` drop and recreate the database `DB_NAME_SERVER` names, and `scripts/dev/load-env-local.sh server/.env.local` sets it to `server_co_managed`. Every test command must export a throwaway `DB_NAME_SERVER` explicitly. No test suite ran this round.

The throwaway databases from the previous round were dropped: `test_cm_tagaudit_*`, `server_co_managed_{0,6,8,11,14,30,35}`, `test_database_1` and `test_database_4`.

## Still open

- **Untagged creation.** Workflows and recurring tickets still create untagged tickets, contacts and clients in a read-only workspace.
- **Entity deletion.** Deleting a contact, client, project or document still removes its tag mappings without lifecycle admission. See [6555ef31ff](../6555ef31ff/README.md#reachable-not-guarded-entity-deletion).
- **PR conflict.** PR #3363 reports a merge conflict, which this round does not resolve.
- **Guide coverage.** The covered guides in the packet opening were recorded on `56e708a31b` against the old database. Their fixtures no longer exist and they were not re-recorded.
