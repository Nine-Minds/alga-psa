# Draft verification

## Baseline

The original MSP profile component was temporarily loaded on the running local stack, with the handed-off draft backed up. A synthetic account's category toggle changed only the display, produced zero preference rows, and reset on refresh. A manually inserted false subtype preference also displayed enabled. The existing draft was then restored and completed.

## Behavioral checks

All 22 focused tests passed:

- `server/src/test/integration/notifications/emailPreferenceActions.integration.test.ts`: real `withAuth` wrapper with a synthetic session provider; unauthenticated actions; caller/payload identity rejection; same-tenant peer and cross-tenant isolation; invalid IDs/booleans; restricted membership; inherited defaults; tenant-wide restrictions; subtype upserts; one bulk statement on one transaction connection; both statement-time and deferred commit-time database failures; complete rollback and duplicate-free retries; connection acquisition failure.
- `server/src/test/unit/notifications/EmailNotificationPreferences.test.tsx`: rendered component hydration, mixed state, pending controls, rapid/overlapping events, slow request feedback, failure rollback, failed reconciliation/load retry, unknown commit outcome, and unmount/re-entry while saving.
- `packages/notifications/src/components/settings/serialMutationQueue.test.ts`: category/subtype/read ordering and recovery after rejection.

The database suite uses an isolated PostgreSQL database with the schema copied from the migrated local stack, no application data, and a test connection pool of one. Authentication/session retrieval and Next route invalidation are test boundaries; actual queries, tenant predicates, transactions, constraints, upserts, and commit failures execute against PostgreSQL. The production pool was not modified.

Representative delivery checks execute `EmailNotificationService.sendNotification` against that database. The outbound adapter sends only to an ephemeral SMTP listener bound to `127.0.0.1`; template/locale lookup is stubbed. Missing preferences and enabled preferences deliver; saved false preferences, tenant-disabled subtypes/categories, and the global tenant gate suppress delivery. No external/customer mail was sent by this verification suite.

Run the focused tests from `server/`, with `TEST_DB_NAME` naming a pre-migrated isolated `email_preferences...test` database and `DB_HOST`, `DB_PORT`, `DB_USER_ADMIN`, and `DB_PASSWORD_ADMIN` supplied privately:

```bash
npx vitest run --config vitest.config.ts \
  src/test/integration/notifications/emailPreferenceActions.integration.test.ts \
  src/test/unit/notifications/EmailNotificationPreferences.test.tsx \
  ../packages/notifications/src/components/settings/serialMutationQueue.test.ts
```

## Running UI on port 3235

- MSP Email: existing false row hydrated; subtype on/off persisted with matching database values and refresh; category on/off updated five rows without duplicates; mixed state remained after page re-entry and sign-out/new login.
- Live injected failure: a temporary trigger rejected writes only for the synthetic tenant. A category save showed an error, left all five prior rows intact, and restored the category's confirmed checked state. Removing the trigger allowed retry to save all five off. The trigger/function were removed after this check.
- MSP Internal: category off/on persisted in the separate internal-preference table; off state survived reload.
- Client-portal Email: a separate synthetic portal user inherited defaults, saved subtype off/on, retained off after refresh, and saved category off/on with matching rows.
- Live tenant restrictions: a subtype forced off by the administrator rendered disabled despite its saved true row. Category off changed only the other eligible children and preserved the restricted row. The tenant-wide off gate made every Email control unavailable and unchecked with administrator hints. Synthetic tenant gates were restored afterward.
- Light/dark screenshots were inspected locally; labels, switches, and the indeterminate category control remained legible. Screenshots and synthetic fixture identifiers are not committed.

## Build and type checks

- Notifications package build and typecheck: passed.
- Client-portal package typecheck: passed.
- Full server typecheck: passed with `NODE_OPTIONS=--max-old-space-size=16384`. The default heap initially exhausted memory.
- Translation validation: passed, zero errors/warnings. Shared Email messages are supplied for every shipped locale, including generated pseudo translations.
- Client-portal standalone package build: unavailable; its existing `tsup` script has no input/configuration and reports `No input files`. Profile compilation is also exercised by the running server and the full server build.
- Full production server build: passed (exit 0) with `NODE_OPTIONS=--max-old-space-size=16384` and a separate `NEXT_DIST_DIR`; static generation and build tracing completed. The default 8 GB heap initially exhausted memory. Build warnings remain in unchanged workflow inference imports, and static probing logs a dynamic-server-use message for the global error route. The separate full server typecheck passed; Next itself skips type validation in this checkout.

## Reviewer focus and limits

Start with `userEmailPreferences.ts` and the personal actions, then review the shared panel's synchronous pending guard, module-level operation queue, and authoritative reconciliation. The category control intentionally uses an indeterminate checkbox; a mixed click enables all eligible children. Pending clicks are ignored rather than accumulated.

The schema and queries were verified on local PostgreSQL, not a distributed Citus deployment. Literal timestamps and the existing tenant-inclusive upsert key preserve the established Citus-compatible shape. Broader database connection availability remains outside this fix.
