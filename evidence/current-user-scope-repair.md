# Current-user security repair scope

The repair removes the sign-in UI, TOTP challenge, CAPTCHA retry, and RJSF dependency changes introduced by `a9a3ad4057`. Those changes fixed separate baseline problems and are not needed to project public user responses. No approved implementation plan was attached to this card.

The shared `USER_RESPONSE_FIELD_NAMES` projection remains in place for both database role loaders, the user model, current-user resolution, and the audited user-query actions. NextAuth still calls the server-only `authenticateUserForAuth` accessor so password and TOTP verification can read credentials internally. The public `authenticateUser` action continues to return projected fields.

The retained callback tests cover both MSP and client users. A missing TOTP code returns `null`, matching the baseline callback. Wrong passwords and invalid codes are rejected; a valid code authenticates and returns public identity without credential fields. The tests no longer require the removed `2FA_REQUIRED` challenge protocol.

## Verification

Verification ran without an application server. The focused suite passed 79 tests across 10 files, including four PostgreSQL tests exercising the ID, email, and model loaders with credential-bearing rows. The database tests use connection-local temporary tables and roll back their fixtures.

The prescribed email-service build passed, including predicates, core, db, event-schemas, event-bus, formatting, shared, storage, and email-service. Separate types and auth package builds also passed.

The full server typecheck passed with exit 0 and no diagnostics: `NODE_OPTIONS=--max-old-space-size=16384 npm run typecheck`, run from `server/`.

Logs and exit files are under `/tmp/alga-smoke-evidence/getcurrentuser-scope-repair`. `verification-commands.txt` records all commands. The focused test command, run from `server/`, is:

```sh
../node_modules/.bin/vitest run --config vitest.config.ts \
  src/test/unit/security/currentUserResponse.test.ts \
  src/test/unit/security/authenticationResponse.test.ts \
  ../packages/auth/src/lib/nextAuthOptions.twoFactor.test.ts \
  ../packages/auth/src/lib/getCurrentUser.test.ts \
  ../packages/auth/src/lib/apiKeyUserContext.test.ts \
  ../packages/auth/src/actions/auth.tenantScoping.test.ts \
  ../packages/auth/src/lib/signInUserResolution.test.ts \
  ../packages/auth/src/components/MspLoginForm.tenantRequired.test.tsx \
  ../packages/auth/src/components/MspLoginForm.tenantScoped.test.tsx \
  src/test/integration/userResponseProjection.db.test.ts
```

The pre-existing lockfile edits were saved, reapplied after restoring the baseline dependency entries, and verified to contain the same hunks apart from line offsets. They remain unstaged and are excluded from the repair commit.

## Review limits

Start with the scope rollback and the retained NextAuth accessor, then the public-response and PostgreSQL regression tests. The prior SQL binding repair remains in the branch because it was needed for the dependency build.

The baseline TOTP UI limitation is again present: these changes do not implement a browser challenge or CAPTCHA retry flow. The removed RJSF alignment no longer fixes the previously observed dependency mismatch. The restored lockfile records core/validator 6.1.2 and utils 6.4.1; the existing installation used for these checks still has RJSF 6.11.0. No clean dependency installation or new ticket-render acceptance is claimed.

The live smoke results and external review guide at `a9a3ad4057` describe that historical revision. They do not establish live acceptance of this repair. No application server, live CAPTCHA retry, production startup, or production application build was run during this repair. The review guide must be refreshed for the new PR revision before it is used as current evidence.

The separate `getConsolidatedTicketData` / `ticketData.availableAgents` credential leak remains assigned to card `e3c2e9fc`. This PR does not establish that the whole ticket page is credential-free.
