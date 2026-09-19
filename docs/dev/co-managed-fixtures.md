# Co-managed IT review fixtures

A reviewer should be able to sit down at <http://100.82.172.57:3374>, sign in, and
exercise every co-managed capability without asking anyone to prepare data —
today, and again next week. `scripts/dev/co-managed-fixtures.ts` builds and
maintains that data set.

```bash
npm run fixtures:co-managed              # apply (safe to run repeatedly)
npm run fixtures:co-managed -- --verify  # list what is present, per capability area
npm run fixtures:co-managed -- --reset   # remove the fixtures, restore the baseline
```

The script reads `server/.env.local` and connects to `server_co_managed` on the
**direct** PostgreSQL port `127.0.0.1:5472`. pgbouncer routes only the `server`
and `postgres` databases, so it cannot be used here.

> **The `.env.local` trap.** Do not load the file with
> `set -a; . ./.env.local; set +a`. `DB_PASSWORD_SERVER` and `REDIS_PASSWORD`
> both contain an unquoted `&`, which bash parses as the background operator,
> so that idiom exports both as **empty strings** and every later connection
> authenticates with no password. Three earlier rounds of this work
> misdiagnosed failures that way. The script parses the file line by line in
> Node; from a shell use `scripts/dev/load-env-local.sh` and check
> `echo ${#DB_PASSWORD_SERVER}` is greater than zero.

## Sign-in details

Every fixture password is deterministic and survives a restart. This matters:
the dev server rotates `glinda@emeraldcity.oz`'s password on every boot, so no
review step should depend on that account.

| User | Tenant (workspace) | Role | Password |
| --- | --- | --- | --- |
| `cm.msp.admin@oz.test` | Oz — sponsoring MSP | Admin | `FixtureMspAdmin!2026` |
| `cm.msp.tech@oz.test` | Oz — sponsoring MSP | Technician | `FixtureMspTech!2026` |
| `cm.rabbit.admin@whiterabbit.test` | White Rabbit — customer, seats spare | Admin | `FixtureRabbitAdmin!2026` |
| `cm.rabbit.tech@whiterabbit.test` | White Rabbit — customer, seats spare | Technician | `FixtureRabbitTech!2026` |
| `cm.munchkin.admin@munchkin.test` | Munchkin Country IT — customer, at seat ceiling | Admin | `FixtureMunchkinAdmin!2026` |
| `cm.munchkin.tech@munchkin.test` | Munchkin Country IT — customer, at seat ceiling | Technician | `FixtureMunchkinTech!2026` |

Hashes are PBKDF2 `salt:hash` — 10000 iterations, keylen 64, SHA-512, with the
PBKDF2 salt formed as `NEXTAUTH_SECRET + salt`, matching
`shared/utils/encryption.ts`. The salt is derived from the fixture slug rather
than drawn at random, so reruns rewrite identical bytes; on every apply the
script asserts each hash is accepted by the shared `verifyPassword()` helper, so
determinism cannot silently diverge from what the application accepts.
`NEXTAUTH_SECRET` is global to the installation, so the hashes are portable
between tenants.

## Workspaces

| Workspace | Tenant id | Role in the review |
| --- | --- | --- |
| Oz | `569e72fc-52d9-4ce2-838e-a34ea8cf2f9f` | Sponsoring MSP, `psa` / Pro |
| White Rabbit | `51ac6952-6d6f-4600-aace-b71a9b2a5e73` | Live customer with spare seats |
| Munchkin Country IT | `54490467-e4b7-58e4-b2f5-74bacfa02ce7` | Live customer at its seat ceiling (created by this fixture) |
| Emerald City IT | `5ff4fb80-b8d0-42c5-939d-7b76afb6de87` | Departed customer: terminated and sealed |

Each customer tenant can hold only one live relationship —
`co_management_one_live_sponsor` is unique on `(tenant) WHERE ended_at IS NULL` —
so a second live relationship requires a second customer workspace. That is why
Munchkin Country IT exists rather than a second relationship on White Rabbit.

Munchkin Country IT is built with the product's own engines, not a hand-written
copy of them: `runOnboardingSeeds` for roles, permissions and templates,
`seedBoardTicketStatusesFromStandards` for ticket statuses, and the
`standard_priorities` catalogue for priorities.

## Capability coverage

All seven areas are fixtured. Concrete row ids follow.

### 1. Pro sponsor seat pool at USD 11.49/seat/month

**The USD 11.49 price is a local record here, not live-Stripe-backed.**
`CO_MANAGED_MONTHLY_SEAT_CENTS = 1149` in
`ee/server/src/lib/stripe/coManagedSubscription.ts` is a repository constant, and
the live purchase path requires `STRIPE_CO_MANAGED_USER_PRICE_ID`, which this
environment does not configure at all. The entitlement row below is therefore a
local seat grant with `source_reference = 'co-managed-fixtures/local-seat-pool'`;
the checkout, invoice and webhook path is **not** exercised. See "Not
fixture-able" below.

| What | Row |
| --- | --- |
| Sponsor entitlement | `co_managed_entitlements` tenant `569e72fc…`, capacity **12**, valid until 2027-12-31 |
| Purchase record | `co_managed_purchase_operations` operation `08db37c3-4eaa-5d06-aba1-917a4c827752`, quantity 12, state `completed` |
| Allocation with headroom | `co_managed_allocations` `c00d4346-003e-4f67-8a6c-654f06ceb92d` → White Rabbit, **4 seats**, 3 users |
| Allocation at ceiling | `co_managed_allocations` `4c31217a-7762-5624-b7fe-042462579486` → Munchkin, **2 seats**, 2 users |

Pool state: capacity 12, allocated 6, available 6, `canGrow: true` — so
**Enable co-managed IT** is enabled. `--verify` proves both ends through the
product's own `assertCoManagedSeatAdmission`:

```
White Rabbit seat admission     -> admitted
Munchkin Country seat admission -> CO_MANAGED_SEAT_LIMIT
```

Adding a seventh technician to Munchkin Country IT is rejected; adding one to
White Rabbit succeeds.

### 2. Escalation with independent MSP SLA timing

| What | Row |
| --- | --- |
| Relationship | `co_management_relationships` `73950eda-1f0e-4196-8480-2ca096c9685d` (White Rabbit, active) |
| Ticket **ready to escalate** | `tickets` `9292ffb5-2535-5878-b24c-c83f7a7ae4df` — `000101`, "Branch VPN drops every afternoon" |
| Ticket **already escalated** | `tickets` `eee9eed2-ae70-584f-8d24-f2a12d7673f8` — `000102`, "Mail flow stalled for the finance group" |
| Escalation state | `co_management_ticket_work` work `404e1b81-92f3-57bc-8979-04953c3210ac`, responsibility `msp` |
| Handoff receipt | `co_management_ticket_handoffs` operation `f80ee074-008d-59db-9476-edfc805b42ed`, transition `escalated` |
| MSP queue reference | `co_managed_ticket_references` `5b9b588c-53ec-5cfb-bf4c-0860d88ecbaf` → Oz board `0bd2216f…` |
| MSP SLA obligation | `sla_organization_obligations` `02fa0e0a-d9b5-5b60-96c1-fa56fae754d8` |
| Priority mapping | `co_managed_sla_priority_mappings`, 5 rows for relationship `73950eda…` |

The two clocks are visibly distinct on the same ticket:

| Clock | Starts | Response due | Resolution due |
| --- | --- | --- | --- |
| Customer end-to-end | 2026-09-10 09:00Z (ticket creation) | 2026-09-10 13:00Z | 2026-09-12 09:00Z |
| MSP, from escalation | 2026-09-15 11:00Z (handoff) | 2026-09-15 12:00Z | 2026-09-15 19:00Z |

Five days separate them, which is the point: the MSP obligation starts at
escalation, not at ticket creation or at the visibility grant. The obligation is
created by the product's own `startOrganizationSlaObligation`, so the stored
clock is built by the real reducer.

Escalating ticket `000101` does not disturb `000102`, so the already-escalated
evidence survives a walkthrough.

The two organizations also name their priorities differently — White Rabbit uses
Low/Medium/High/Urgent/Critical, the five Oz priorities on the other end of the
mapping are `P1 - Critical`…`P5 - Planning` — which is exactly why the mapping is
stored per relationship instead of matched by name. (Oz carries three further
ticket priorities from earlier smoke data that no mapping row names.)

### 3. Private notes stay within the authoring organization

Three notes on ticket `000102` (`eee9eed2…`):

| Note | Row | Visible to |
| --- | --- | --- |
| Shared IT note, authored by Oz | `comments` `31a6a0b8-2600-59cf-92c9-b83f2c6b4ce0`, audience `shared_it` | both organizations |
| Customer-private note | `comments` `e5b92878-7db1-58a4-86fb-7ffa651fd621`, audience `organization_private` | White Rabbit only |
| MSP-private note | `co_management_private_comments` `1bf28449-ea3b-5706-98a2-4c4a8d3cee4a` (Oz tenant) | Oz only |

Signing in as `cm.msp.tech@oz.test` and then as `cm.rabbit.tech@whiterabbit.test`
shows a different subset each time. The private note lives in a different table
in a different tenant, not behind a flag on a shared row.

### 4. MSP commercial time vs customer operational effort

Both recorded against the same shared work item, ticket `000102`.

| What | Row |
| --- | --- |
| Shared work reference | `co_managed_time_work_references` `b348c0a7-0d66-5ee7-b38a-b5fa6ebb7361` in Oz, source `ticket` / `eee9eed2…` |
| MSP commercial time | `time_entries` `e30b01de-0c92-5b27-bda4-8cb6ca7d7ad7` (Oz), `work_item_type='co_managed'`, `billing_mode='commercial'`, **90 billable minutes** |
| Customer operational effort | `time_entries` `db2ae7b4-87a3-5e09-acb7-63dad95e562b` (White Rabbit), `work_item_type='ticket'`, `billing_mode='operational'`, **0 billable minutes**, 45 minutes elapsed |

The effort panel reports Customer 45 min, MSP 90 min, Combined 135 min. The
operational entry carries no service, contract line, tax or invoice attributes —
`time_entries_billing_mode_check` forbids them.

### 5. Customer export/upgrade and safe departure

Two separate relationships, so inspecting departure evidence never ends the live one.

| What | Row |
| --- | --- |
| Live relationship to export/upgrade from | `co_management_relationships` `73950eda…` (White Rabbit, `active`) |
| Departed relationship | `co_management_relationships` `3559d6b5-5e51-4766-b891-014d85f31429` (Emerald City, `terminated`) |
| Closure record | `co_managed_relationship_closures` operation `f506d5e8-0085-42eb-be80-761ac617e96e`, reason `departure`, 2 seats released |
| Sealed archive manifest | `co_managed_archive_manifests` operation `f506d5e8…`, content hash `f06c8864…80d`, sealed 2026-09-09 |
| Retained MSP evidence | `co_managed_participation_evidence`, 19 rows (16 Emerald City + 3 White Rabbit) |

The fixture **reads and asserts** the Emerald City closure; it never rewrites it.
That relationship is sealed, and the sealed-closure path idempotently re-seals a
hand-flipped row, so nothing here flips it back to active. If the closure or
manifest were ever missing, apply prints a `departure evidence warning` rather
than fabricating one.

Retained White Rabbit evidence rows (MSP side, immutable):
`ticket_handoff`, `time_entry` and `conversation` sources for ticket `eee9eed2…`.
Their `payload_hash` is computed by the fixture over the payload alone, while
`appendParticipationEvidence` hashes the whole content record. Nothing reads
those three hashes — the archive manifest copies them verbatim and the store
only compares on a replay of the identical source row, which no review step
performs — but they are not the hashes the product would have written.

**Export works; the hosted upgrade stops at the screen.**
`withCoManagedExportAdmin` admits `cm.rabbit.admin@whiterabbit.test`, and
`getCoManagedIndependentUpgradeScreen` returns
`state: eligible, seatsRequired: 3, entitlementReady: false, hasOwnBilling:
false`. Completing the upgrade needs a paid hosted PSA subscription, and this
environment defines no `STRIPE_*` variables at all (see "Not fixture-able"), so
a reviewer can reach and read the upgrade screen but cannot finish the upgrade.

### 6. Delegated administration

| What | Row |
| --- | --- |
| Scoped grant | `co_management_delegated_grants` `cd2e8168-d76a-502a-93b3-c3211bae6b2e` |
| Grantee | `cm.msp.admin@oz.test` (`0485fbba-f693-5faf-ad5a-9ceb1f904ed5`), operation `board_settings` |
| In scope | White Rabbit board **Service Desk** `59c51e85-5942-4580-81fa-8a924d60ff89` |
| Out of scope | White Rabbit board **Executive (private)** `e58fc9c6-8003-5a35-8bbc-3dc85e51f809` |

The Executive board is deliberately absent from both
`co_management_board_scopes` and every delegated grant, so the limit is
demonstrable rather than asserted. `co_management_board_scopes` contains exactly
one row for this relationship: the Service Desk board. The customer's own
delegation picker still lists the Executive board — a customer may delegate any
of its boards — but no grant names it, so it stays outside the MSP's reach.

The grant's `target_fingerprint` is **NULL**, which is what
`saveCoManagedDelegatedGrant` stores for a `board_settings` grant:
`targetRecord()` computes a fingerprint only for `invitation_resend`, where it
pins the invitation's terms. `admitGrant()` recomputes the fingerprint on every
read and drops any grant that does not match, so a grant row carrying an
invented hash is inert — present in the table, invisible to its grantee.
`--verify` therefore reads the MSP administrator's own delegated screen instead
of the row:

```
MSP administrator's delegated screen -> Service Desk (board_settings)
Executive (private) board            -> out of the MSP administrator's reach
```

### 7. Shared-history collaboration

| What | Row |
| --- | --- |
| Customer-owned project | `projects` `c4303472-961b-5191-9e78-6c709b987d7d` — "Branch network refresh" |
| Explicit share | `co_management_project_scopes` project `c4303472…`, `can_collaborate = true` |
| Shared task | `project_tasks` `d65d3c58-17f5-57f2-abc7-70bea5b2447c` — "Replace the distribution switch stack" |
| MSP-side reference | `co_managed_project_task_references` `523abf82-8e35-5794-b407-9b5726fc80de` |
| Customer comment | `project_task_comments` `aceb9fa1-46b0-5197-a5cf-c75c731d11ab` — local White Rabbit user |
| MSP comment | `project_task_comments` `466fe024-3395-5e13-bb2d-3f311b756c1d` — attributed to **Oz** via `collaboration_actor_references` |

Both comments sit on one thread on one task, and each carries its
organization, so the history reads as a single conversation between two named
organizations.

## Idempotency and reset

Every identifier is `uuidv5(namespace, slug)` and every timestamp is a fixed
instant, so an apply is a rewrite of the same bytes rather than an append.

**Two consecutive applies leave every fixture row untouched.** Dumping every
tenant-scoped row for all four tenants as sorted JSON before and after a second
apply covers **56,556 rows**, and no row this script owns differs. The only
rows that moved anywhere in the database belong to whatever else is running
against the environment:

| Table | What moved |
| --- | --- |
| `jobs` | the dev server's recurring `recover-comment-publications` job — `status` and `lastRunAt` |
| `workflow_runtime_events` | four new `MAINTENANCE_JOB_REQUESTED` rows from the same scheduler |
| `user_preferences` | `updated_at` on one `theme` row, written by a browser session signed in as `cm.msp.admin@oz.test` |

(The row total depends on how much scheduler history the environment has
accumulated: `job_details` and `workflow_runtime_events` alone were 52,863 of
those 56,556 rows.)

**Reset restores the baseline.** `--reset` deletes the fixture's own rows,
purges the Munchkin tenant, and restores the two values the fixture adopts from
pre-existing rows:

| Adopted value | Baseline restored by `--reset` |
| --- | --- |
| `co_managed_entitlements.capacity` (Oz) | 3, reference `smoke-fixture-sub-2026-09-09`, valid until 2026-10-09 |
| White Rabbit allocation seats | 1 |

After a reset the database holds three tenants again and `--verify` reports only
the five pre-existing rows the fixture adopts rather than creates. The
capability probes go red as well and `--verify` exits non-zero, because the
capabilities really are gone: the Munchkin workspace no longer exists to hold a
seat ceiling, and `cm.msp.admin@oz.test` no longer exists to open a delegated
screen, which reports `unavailable to cm.msp.admin@oz.test`. That is the reset
working, not a fault.

**Reset followed by apply returns to the same state**, with one documented
exception. Comparing a full dump across a reset-and-reapply cycle:

- The 1161 rows outside the onboarding seed engine are **byte-identical**.
- The reference data the product's own seed engine creates — `permissions`,
  `role_permissions`, `roles`, `statuses`, `asset_type_registry`,
  `document_default_folders`, `project_template*` — is **logically identical**
  (532 natural-key rows match exactly) but carries fresh surrogate uuids,
  because `runOnboardingSeeds` assigns them with `gen_random_uuid()`.

That is the deliberate cost of driving the real seeder instead of
reimplementing the permission catalogue, which would drift. Everything this
script assigns itself, including the notification-settings surrogate keys, is
derived and stable.

## Durability

- The entitlement is valid until **2027-12-31**, so the pool does not lapse
  between reviews. A lapsed entitlement would push the relationship into the
  30-day grace path and eventually read-only.
- All fixture passwords are deterministic and unaffected by dev-server restarts.
- Nothing in the fixture is consume-and-delete. The journeys that mutate state
  have their own pre-staged subject: escalation has a spare ticket, departure
  has a separate already-terminated relationship, and over-allocation has its
  own customer workspace.

## Not fixture-able

### Live Stripe-backed purchase of the USD 11.49 seat pool

The purchase journey — checkout session, paid invoice, subscription with
`metadata.subscription_kind=co_managed`, and the webhook that converts it into
capacity — **cannot be fixtured in this environment**. It requires a configured
`STRIPE_CO_MANAGED_USER_PRICE_ID` and live Stripe credentials, and
`server/.env.local` defines no `STRIPE_*` variables at all.

What the fixture provides instead is the *outcome* of a purchase: a hosted
entitlement row with capacity 12 and a `completed`
`co_managed_purchase_operations` record whose `provider_reference` is literally
`local-record-no-stripe`. A reviewer can exercise everything downstream of
capacity — allocation, provisioning, seat admission, over-allocation rejection —
but must not read the 11.49 figure on screen as evidence that billing works
end to end. Price display, checkout and invoice reconciliation remain
**unverified** here.

### Related deployment dependency

Self-hosted co-managed capacity additionally needs an external signed-license
issuer (`co_managed_entitlements.source = 'self_host'` requires
`signed_license`). The fixture uses `source = 'hosted'` and does not exercise
the signed-capacity path.
