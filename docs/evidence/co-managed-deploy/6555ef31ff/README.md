# Remaining tag writers: workflow actions and session-free ticket creation

This round follows [tagfix-ccb29f50](../tagfix-ccb29f50/README.md). That round closed the tag server actions, both ticket-screen layouts, the ticket list and the REST `TagService`/`ClientService`. It listed three writer families as unguarded: `createTicketWithSideEffects` tag writes, management-tenant `TagModel` uses, and workflow contact/client tag writes. This round audits each one from the code. The reachable ones are closed in `6555ef31ff`.

## Live check: not run

**The live denial and positive controls were not re-run, and there is no `04-ended-tag-write/` receipt.** During this round the review database was lost. Restoring it needs a human.

- **What happened.** At 23:28Z the database `server_co_managed` was dropped and recreated empty. It lives in `co-managed-it-postgres` on 127.0.0.1:5376, and the review-app on :23374 reads it. The cause was the DB-backed workflow-action suites (`shared/workflow/runtime/actions/__tests__/*.db.test.ts`). I ran them with `DB_NAME_SERVER=server_co_managed` in the environment. `scripts/dev/load-env-local.sh server/.env.local` sets that value too. Their harness runs `recreateDatabase(process.env.DB_NAME_SERVER || 'test_database')`.
- **State now.** The new database has 0 tenant rows. The terminated customer `d46de2e8`, Alice and QA in Oz are gone ([receipt](raw-logs/review-db-loss-receipt.json)).
- **No recovery path from here.** `archive_mode` is off, no dump exists, and the volume sits under snap Docker, which needs root.
- **Serving.** The review-app still serves `ccb29f50` / `build-1792967039963` from `server/.next-review-final-ccb29f50`, and `/api/health` returns 200. With no tenants, nobody can sign in.
- **No rebuild.** There is no data to verify a new build against, so this round did not rebuild.
- **To finish.** Restore or re-provision the review data. Then rebuild through `run-co-managed-review-app.sh` at this head, and run the step-2 scenario into `04-ended-tag-write/`.
- **Rule for these suites.** Always run them with a throwaway `DB_NAME_SERVER` and `--no-file-parallelism`. This round's passing run used `test_cm_tagaudit_shared`.

## Writer audit

### Reachable: guarded in `6555ef31ff`

**Why a terminated customer can reach these.** A co-managed workspace may author and publish workflows: `/msp/workflow-editor` and `/msp/workflow-control` are allowed for `co_managed` in `productSurfaceRegistry.ts`. Nothing stops an already-published workflow after termination. `launchPublishedWorkflowRun` and the schedule and date-trigger launchers do not admit lifecycle. The runtime's `withTenantTransaction` does not admit it either. The workflow ticket mutation adapter admits only the ticket-update actions. Recurring ticket definitions also keep generating after termination: `generateRecurringTicketsForTenant` checks no lifecycle.

| Writer | Path | Guard |
| --- | --- | --- |
| `createTicketWithSideEffects` tag step | workflow `tickets.create`, recurring generator, billing renewal tickets | `assertCoManagedOperationalWrite(trx, tenant)` at the top of the service when tags are requested, before the ticket row is written |
| workflow `contacts.create` / `clients.create` with tags | `shared/workflow/runtime/actions/businessOperations/{contacts,clients}.ts` | `admitWorkflowTagWrite` right after the permission check, when tags are requested |
| workflow `contacts.add_tag` / `clients.add_tag` | same | `admitWorkflowTagWrite` right after the permission check |
| workflow `contacts.duplicate` / `clients.duplicate` with `copy_tags` | same | the source tags are now read before the duplicate is written, and admission runs first when there are any |
| workflow `projects.add_tag` / `projects.add_task_tag` | `projects.ts` | `admitWorkflowTagWrite` right after the permission check |
| workflow `crm.tag_activity` | `crm.ts` | `admitWorkflowTagWrite` right after the permission check |

The audit found the last two rows outside the dossier's list. They are the same kind of writer, so they are closed the same way.

`admitWorkflowTagWrite(ctx, tx)` lives in `businessOperations/shared.ts` and runs `assertCoManagedOperationalWrite` in the action's own transaction. A refusal surfaces as an action error with the lifecycle code (`CO_MANAGED_READ_ONLY`, or `CO_MANAGED_NOT_ACTIVE` while acceptance is pending), the product message, and `details.lifecycle_state`. `rethrowAsStandardError` maps a lifecycle error the same way, so the run no longer reports `INTERNAL_ERROR`. Each refusal rolls the whole action back, ticket, contact or client row included.

**Lock order.** Admission is the first locking step in every guarded transaction. The one exception is the recurring generator, which claims its occurrence ledger row before it calls the service. No lifecycle transition touches that row, and a refusal rolls the claim back. `recordFailure` then records the occurrence as `failed` with the read-only message.

### Unreachable

- **`TagModel.createTag` in `customer-tracking-activities.ts` and `tenant-deletion-activities.ts`.** Both pass the tenant returned by `getManagementTenantIdInternal`, which is the "Nine Minds LLC" management tenant. It is a native PSA tenant, never a co-managed customer workspace, so no terminated customer reaches these writes. Tenant deletion must also keep working for a terminated workspace.
- **`server/src/lib/utils/tagCleanup.ts`.** Nothing imports it.

### Reachable, not guarded: entity deletion

Deleting an entity removes its tag mappings as part of the delete, but that is entity deletion, not a tag write. The previous instruction kept the ticket screen's Delete button out of scope. Guarding only the tag cleanup inside a delete would admit lifecycle after the other child rows were already removed. The correct fix is lifecycle admission for the delete itself. The following paths remain reachable for a read-only workspace:

- workflow `contacts.delete`, `clients.delete` and `projects.delete`;
- the native `deleteContact` and `deleteDocument` server actions (`@alga-psa/tags/lib/tagCleanup` callers).

The native `deleteProject` is already admitted. These do not let a terminated customer *persist* a tag. They remove an entity together with its tags.

### Not tag writes, recorded as friction

The guards are scoped to tag writes as instructed. The same actions create untagged tickets, contacts and clients without admission, and so does the recurring generator. Two `LEVERAGE: friction` markers record this, `workflow-lifecycle-admission` and `ticket-create-lifecycle-admission`. The layer that is missing is lifecycle admission in the workflow runtime's write transaction and in ticket creation.

## Tests

- **Tag lifecycle block in PostgreSQL.** The `co-managed tag lifecycle admission` block now has 9 tests, all passing ([log](raw-logs/integration-tag-lifecycle-focused.txt)). Three are new:
  - **Denial.** A terminated customer runs all eleven writers, each with real targets created while the workspace was active. The writers are workflow `tickets.create`; the service as the system actor (the recurring and renewal path); `contacts.create`, `add_tag` and `duplicate`; `clients.create`, `add_tag` and `duplicate`; `projects.add_tag`; `projects.add_task_tag`; and `crm.tag_activity`. Every one rejects with `CO_MANAGED_READ_ONLY` and the product message. Tag definitions, mappings, tickets, contacts and clients are all byte-identical afterwards, and no workflow event is published.
  - **Positive controls.** For an active co-managed tenant and for a native PSA tenant, all eleven writers succeed and land exactly the expected tags.
- **Per-guard mutation check** ([log](raw-logs/integration-workflow-per-guard-mutation.txt)). Each of the eleven guards was removed on its own, including the shared helper body. Each removal turned the denial test red, and the resolved value shows which writer then went through.
- **Full integration file:** **1478 / 1478 passed**, the previous 1475 plus the 3 new tests ([log](raw-logs/integration-full-file.txt)). This file clones its schema from `DB_NAME_SERVER` with `pg_dump --schema-only`. After the loss, `server_co_managed` holds only the CE schema, and a run against it fails 23 EE-dependent tests on missing tables such as `stripe_subscriptions` and `scim_connections` ([log](raw-logs/integration-full-file-ce-schema-source.txt)). The passing run used `test_cm_tagaudit_schema_src` as its schema source instead. That database is a template copy of the previous round's clone `co_managed_bootstrap_ccae54…`, cloned from `server_co_managed` at 22:08Z, with the test's catch-up migration names added to its ledger.
- **Workflow action suites.** The shared workflow action suites (DB-backed and contract) and the renewal ticket tests passed: 263 tests in 45 files ([log](raw-logs/shared-workflow-actions.txt)).
- **Server tests.** The workflow ticket assignment, renewal queue, recurring generator, renewal event and ticket-created coverage suites passed: 82 tests in 6 files ([log](raw-logs/server-touched.txt)).
- **UI.** `ticket-columns.tagsReadOnly.test.tsx` passed 2/2 ([log](raw-logs/ui-list-tags-read-only.txt)).
- **Static checks.** Typecheck passes for the server (12 GiB), `shared`, `ee/temporal-workflows` and `services/workflow-worker`. `check:transaction-threading` (754 files) and `check:dist-resolution` (241 modules) also pass.

## README opening

The opening of [implement-20261025/README.md](../implement-20261025/README.md) was regenerated with `scripts/render-co-managed-evidence-opening.mjs` against the served build. `--check` reports that it matches the ledgers: 11 covered, 0 partial, 3 blocked-external ([log](raw-logs/readme-opening-render.txt)). The section below it is now titled and worded as the record for build-1792934305248 / `a46feefa6f`, in the past tense, so its "two covered, twelve partial" and 32/260 counts no longer read as current. `completion-verdict.json` and the census are unchanged.
