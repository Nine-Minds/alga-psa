# Co-managed relationship provisioning and acceptance

An entitled MSP enables co-managed IT from a client's **Co-managed IT** tab.
Provisioning reserves seats and invites a customer administrator. The relationship
stays `pending_acceptance` until that administrator accepts the displayed terms.
Ordinary customer actions and API requests are blocked during that interval.
Acceptance activates the relationship and its allocation together. Board/project
sharing and delegated administration belong to later cards.

## Deployment preflight

Keep Oz's rollout off until the server and deployed worker revisions match and the
worker is ready. A successful worker build, a healthy worker on another database,
or fixture verification alone does not meet this condition. Workers use durable
participation, not PostHog rollout evaluation.

The L1a migration sequence is `20261028130000`, `131000`, `131500`, `132000`,
`133000`, and `134000`. These create the foundation, provisioning operations and events,
allow system-seeded priorities, and validate the expanded product-code constraint.
Use the CE+EE migration runner; do not copy EE migrations into the branch's CE
migration directory. Do not globally backfill co-management permissions.

### Reconciling the wired development database

The shared development database contains migration history from other branches.
Do not delete those history rows, replace migrations with no-ops, or disable
Knex's migration-list validation. A list of applied names is not proof that the
current source version produced the existing schema.

1. Take a private custom-format `pg_dump` and restore it into a disposable database.
   Keep the dump outside git with mode `0600`. Use direct Postgres, not PgBouncer,
   if its database allowlist rejects the new database name.
2. Prepare a private source workspace containing this branch's CE and EE migration
   trees, resources, dependencies, knexfile and unchanged
   `server/scripts/run-ee-migrations.js`. Supply the normal secret files privately.
3. Add the seven missing applied migration files to that private workspace under
   their original `server/migrations/` names, from the commits below. Verify their
   bytes before use. Do not add these foreign migrations to the L1a PR.
4. Run the unchanged combined runner's `status` action against the restored copy.
   Compare columns, defaults, constraints, indexes and dependent objects with the
   migration sources. Review pending migrations before choosing an upgrade order.
5. Rehearse individual prerequisite migrations through Knex `migrate:up <name>`
   against the combined directory retained with `EE_MIGRATIONS_KEEP_TMP=1`.
   This records real migration completion. Calling an exported `up()` directly
   does not update history and is only an experiment.
6. Repeat the read-only combined `status` check against the wired database using
   the same verified private sources. Shared schema changes require the ordered
   reconciliation to have passed on the restored copy first.

| Migration file | Source commit |
| --- | --- |
| `20261016100000_create_quote_access_links.cjs` | `a719788caa73995e2169f7382c2bba1106d32248` |
| `20261020120000_create_ticket_watchers.cjs` | `6f2d4263f9d29cff968bca0509a1a02d4ff91268` |
| `20261022090000_add_service_request_audience_scoping.cjs` | `beb1af2f2d0c31201077172fc274267fafe99eeb` |
| `20261025120000_create_tag_references.cjs` | `87bb3d19bf598678bc775a3ad7411b637f26ea20` |
| `20261027120000_add_msp_tenant_recovery_email_template.cjs` | `e5f9f7f523f4c68ff1def03fa2cf55ca867df728` |
| `20261028004451_seed_quote_lifecycle_workflow_events.cjs` | `4244fe2301c0c29a7ff395e50a951d7f0aa0a83a` |
| `20261028020000_create_webhook_event_receipts.cjs` | `9a77c262fbb5d9f1eeca9fd308b88d6e3aa8c037` |

The last two commits are fetchable from
`Nine-Minds/alga-psa` at `refs/pull/3935/head`. Their file SHA256 values are
`805c085f1dfe9325313a433cf9f338e83db0643c032185596bc314de2328bbc7` and
`d1588bad33033fb4f0cf4e86b618b952ea43da258311f4a8274f689d51d89e59`, respectively.

### Prerequisite findings and limits

The verified foreign-source overlay makes the combined `status` runner succeed
without deleting or rewriting history. The initial preflight found eight CE
and 64 EE migrations pending. Do not run `latest` indiscriminately: this includes
broad permission reconciliation, view removal, payment-data rekeying, and Citus
distribution work with constraint replacement and local-data truncation.

Two targeted EE migrations were rehearsed through Knex on a fresh restored copy:

1. `20260220143000_create_entra_phase1_schema.cjs` supplies the tables used by
   worker schedule discovery. It also adds client/contact columns and seeds one
   sync-settings row per tenant; the snapshot produced 25 rows.
2. `20260725130000_entra_sync_enabled_default_off.cjs` sets automatic Entra sync
   off. After both migrations, the copy has no enabled automatic syncs or active
   Entra connections, the worker discovery query succeeds, and 70 migrations
   remain pending. Both migrations were then applied through Knex to the wired
   database. All 1,165 original history entries remain; there are now 1,167
   completed entries, eight CE and 62 EE pending migrations, and zero enabled
   automatic syncs or active Entra connections. This is a tested prerequisite
   subset, not a complete upgrade of the shared database.

The schedule table has separate drift: it was created after the workflow
`tenant_id` conversion had already been recorded. Its `tenant` column is populated,
but seven indexes still use nullable `tenant_id`. Replaying the existing contract
migration on a copy rebuilds these indexes and drops the old column; its textual
replacement also changes one index name to `tenant_workflow_schedule_tenantx`.
Do not deploy that experiment as a blanket replay or change applied history.
Preserve index names and inspect dependencies when preparing a dedicated repair.
Do not replay the expansion migration against already-contracted workflow tables.
The wired database is plain Postgres; the Citus distribution path still requires
separate staging validation before use on Citus.

## Runtime and external handoff

The mitigation does not start or restart the app. Browser checks, server bootstrap
evaluation and the final kill-switch restart therefore require an operator handoff.

The current wired app address is
`http://feature-cm-l1a-relationship-provisioning-acceptance.localhost:3553`.
Reconnect the Alga Dev viewer to this host, then verify a card-scoped browser:

```sh
alga-dev space-new-tab --type=browser --projectId=9417604b-fea9-4345-8098-bc4907ca1f7f
```

Use the returned pane ID to prove navigation and DOM interaction. Host `ping`
alone does not establish a connected viewer or hub responder.

Target `release-v2-0-feature` using fixture tenant UUIDs. The database has two
tenants named Oz, so targeting by display name is unsafe.

| Fixture | Tenant UUID | Rollout target |
| --- | --- | --- |
| Kansas | `7fdaef28-0fcd-551d-aae4-61bbfbe0424c` | Off |
| Emerald | `42742353-79a8-5a3b-8f72-61797aeb7861` | On, with no entitlement |
| Oz | `07bd2899-c813-5ac2-9344-4b6d949419f2` | Off until the matching deployed worker is ready; then on |

A PostHog project administrator must set and verify these targets. The mitigation
environment has no PostHog management credential. Verify the server's tenant-only
evaluation and client bootstrap after targeting; the fixture command only prints
expected flag values. Do not use `FORCE_CAPABILITIES=co-managed:on` or a global
feature-flag override to stand in for the Emerald neutrality check.

Server and worker configuration currently agrees on Temporal
`127.0.0.1:7374`, namespace `default`, queue `cm-l1a-smoke-0348e2924a`.
The controlled mailbox is Mailpit, bound to loopback SMTP `39471` and UI `39472`.
Both processes use `EMAIL_ENABLE=true`, `EMAIL_PROVIDER_TYPE=smtp`, and the same
`EMAIL_HOST`, `EMAIL_PORT` and `EMAIL_FROM`. The worker also has
`EMAIL_PROVIDER=smtp`. Keep authentication values in the existing private env files.
An enabled customer-specific provider can take precedence over system SMTP;
inspect effective selection before sending an invitation.

Build the worker, deploy it last, and execute its actual entry point:
`node dist/ee/temporal-workflows/src/worker.js` from `ee/temporal-workflows`.
`node .` can exit without starting the worker. Check `/ready`, every configured
queue's poller, and source/image revision before enabling Oz. The worker also
polls `alga-jobs` and `sla-workflows` even with a custom task queue.

A rebuilt worker from `0348e2924a` passed readiness and poller checks on the
disposable database in an isolated Temporal namespace. It was shut down and its
isolated schedules/executions cleaned up. This does not establish wired worker
deployment or authorize enabling Oz.

## Browser review after the handoff

These steps come from the implemented components and English locale strings;
they have not been verified in a live browser. Record them with Alga Dev outside
git, with database receipts. Protect against premature access, duplicate seats,
over-capacity admission, undelivered invitations, repeated seat release and a
kill switch that only hides UI.

1. **Neutrality, chapter 0.** As Kansas, then Emerald, open tickets and a client.
   Kansas's flag is off; Emerald's is on without entitlement. Neither should gain
   co-managed client controls. The co-managed overview remains unavailable to
   unadmitted tenants. Confirm the PSA steady-state query budget remains unchanged.
2. **One workspace per request.** As Oz's fixture administrator, open
   **Disposable Enable Co** → **Co-managed IT** → **Enable co-managed IT**.
   Supply Workspace name, Administrator name, a unique controlled Administrator
   email, two Technician seats, Visibility, and the **Escalations** board; submit.
   Recover/retry the same request with its original operation ID and payload.
   Confirm exactly one operation, customer tenant and allocation, with two seats
   reserved once. A changed payload under that ID must not create another workspace.
3. **Customer consent and delivery.** Confirm the invitation actually reaches
   Mailpit, then use its link in a separate customer browser session to set a
   password. Before acceptance, direct `/msp/tickets` navigation must keep the
   acceptance boundary visible, and ordinary actions/API calls must be denied.
   The relationship remains `pending_acceptance`, with no `accepted_at` receipt.
   Test the one permitted resend and refusal of another resend through general retry.
4. **Activation and capacity.** Review the terms and use the acceptance button
   (`#co-managed-accept-relationship`). Oz should see **Active** after refresh.
   Confirm customer-local `accepted_by`, `accepted_at`, the incremented revision,
   matching `scope_fingerprint` event receipt, and an active allocation. Replaying
   that acceptance must not add another event. Separately exercise an exhausted
   allocation on invitation/signup and acceptance, including distinct pending
   emails; rejection must leave users, tokens and activation unchanged.
5. **Product boundaries.** As the active customer, visit `/msp/billing`,
   `/msp/quotes`, `/msp/accounting`, `/msp/projects` and `/msp/documents` directly.
   Check the registered product denials, not just missing links. The allowed
   ticket surface must remain usable.
6. **Seats return once.** Enable **Disposable Cancel Co**, then use **Cancel setup**
   and its confirmation. Wait for cleanup. Repeat cancellation/recovery and verify
   one released allocation, unchanged available seats after the first release,
   and refusal of the cancelled invitation. Decline must use the same cleanup path.
7. **Kill switch, final chapter.** In the authorized live-review phase, set
   `FORCE_CAPABILITIES=co-managed:off` and restart the review app and worker with
   matching settings. Verify gated entry points, invitation verification/send and
   signup are denied without token consumption, new users, delivery or relationship
   changes. Remove the override and verify recovery. Keep the feature off if the
   review cannot complete; use a traffic flip for rollback, not down-migrations.

Use `co_managed_provisioning_operations` and `co_managed_allocations` keyed by
`(tenant, operation_id)` for sponsor receipts. Use the operation's
`(customer_tenant, relationship_id)` for customer-owned
`co_management_relationships` and `co_management_relationship_events`.
Check data after each transition rather than relying on a status label or toast.

The focused integration suites and isolated worker preflight support the review.
Acceptance still requires the recorded chapters and their database receipts.

## Customer permission bootstrap

The co-managed onboarding seeds use the shared permission catalog and role
compiler. Native helpdesk permissions are declared for `co_managed`; the MSP
Admin receives the product's MSP-scoped permissions and other default roles
receive the grants declared for them. Commercial permissions are excluded. This
extends the approved plan's catalog ownership beyond the two `co_management`
entries to the native entries needed by customer helpdesk surfaces. It does not
change PSA or AlgaDesk grants, or backfill existing tenants.

The disposable CE+EE provisioning suite runs with
`cd ee/temporal-workflows && npx vitest run --config vitest.co-managed.config.ts`.
Its activities run synchronously and its invitation delivery and action auth
facades are mocked. The signup test also checks the real RBAC reader against the
seeded customer Admin after acceptance. This is not worker, HTTP, or browser
evidence; complete the live chapters above before rollout.

An already provisioned customer does not acquire these grants automatically.
For a repair, first audit that one customer's roles and permissions and review
any intentional grant removals. Apply only approved missing catalog identities
and default-role grants to that tenant in a transaction, preserving existing
permissions and custom roles; repeat the audit to verify idempotency. Do not run
the unscoped onboarding seed or a fleet-wide reconciliation. The retained
customer used in the previous smoke remains unchanged.

Knowledge-base reads accept a separate `knowledge_base:read` permission. The
fresh-bootstrap suite exercises the article-list action with the seeded Admin,
then removes that grant and verifies denial; the Admin has no general
`document:read` permission. PSA and AlgaDesk can continue to use their existing
`document:read` grant. The RBAC check resolves both permissions in one read.

Customer attachment reads and uploads use `ticket_attachment:read/create`.
Each scoped operation must resolve a ticket in the caller's tenant and pass
its ticket permission and visibility checks. Mixed upload targets, unrelated
documents and foreign tickets are refused. File viewing embeds the customer
restriction in the existing document query. General document library access
remains unavailable to these roles. Existing PSA and AlgaDesk document grants
remain sufficient.

Article actions and KB API readers share the same read policy. Portal readers
use the published client/public audience filter and cannot use their scoped
grant to call the internal article readers. The grants permit reading; article
editing retains its separate authorization requirements.

Run the native-access regression with:

```sh
cd ee/temporal-workflows
npx vitest run --config vitest.co-managed-access.config.ts
```

This suite creates a disposable CE+EE database and signs up a freshly seeded
customer. It uses the real session revocation check, `withAuth`, RBAC, API-key
validators and ticket/KB controllers. It checks pending-consent refusal,
unchanged key state, ticket reads after acceptance, foreign-tenant refusal,
commercial denials, article content, grant removal and scoped attachment
upload/list/download. Cookie decoding, activity context and transport I/O are
substituted. The real worker and SMTP check are separate from this suite.

API key validation checks pending acceptance before changing the key's
last-used state. In the disposable provisioning suite, a key for the newly
signed-up administrator is refused with `CO_MANAGED_NOT_ACTIVE` through both
tenant-specified and tenant-discovery validation. Its row remains unchanged.
After acceptance the same key validates. This exercises the key validator and
the real lifecycle provider. The native-access suite additionally exercises
the ticket controller, browser action guard and session-authenticated download
refusal.


## Isolated built-worker regression

The same five native-access cases can run after an actual Temporal workflow
creates the customer. Run the two integration configurations serially: their
disposable database bootstrap also updates shared PostgreSQL roles. Build the worker and supply the seed assets copied by its
Dockerfile before running this opt-in suite:

```sh
# From the repository root:
npm -w ee/temporal-workflows run build
cp -a ee/server/seeds/onboarding ee/temporal-workflows/dist/seeds/
cp -a server/migrations/utils/permissions ee/temporal-workflows/dist/seeds/
cp server/migrations/utils/tenantDb.cjs ee/temporal-workflows/dist/seeds/tenantDb.cjs
cd ee/temporal-workflows
npx vitest run --config vitest.co-managed-worker-access.config.ts
```

This local suite uses the worker `.env`, the disposable test database settings,
Temporal at the configured address, Redis, and Mailpit at `127.0.0.1:39472`.
It creates a new Temporal namespace and queues, starts the compiled worker,
checks readiness and each queue's matching poller, and runs the provisioning
workflow. It verifies the delivered invitation in Mailpit and that the worker's
`OUTBOUND_EMAIL_SENT` event reached authenticated Redis. It reads the signup token from that delivered message, then runs signup,
consent, ticket action/API, KB and attachment checks against that customer.
The suite stops its worker, removes its schedules/running executions and drops
its disposable database. It never starts the app server or changes Oz targeting.

The isolated run at implementation commit `0570de61de` also retained receipts
outside git under `/tmp/alga-smoke-evidence/cm-l1a-takeover-20261028`.
This is worker and adapter validation. The managed application at port `3553`
was unavailable during the mitigation. Actual PostHog targeting and the live
browser chapters remain an operator handoff; keep Oz off until the deployed
server and worker revisions match and all deployment prerequisites pass.

Redis runtime configuration previously supplied a stale password for
`127.0.0.1:6374`. The workspace `secrets/redis_password` authenticated successfully.
The private server and worker env fallbacks were corrected to that value.
No credential is stored in this guide or in the PR.


The mitigation verification passed the five native-access cases with each
provisioning transport, the 24-case provisioning suite, capability/resolver and
query-budget checks, focused auth/document tests, the Temporal worker build,
full server typecheck and enterprise webpack build. The build completed with
existing dependency/export warnings. No tenant-wide permission reconciliation
was run; the retained customer still requires a separately reviewed scoped repair.
