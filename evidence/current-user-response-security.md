# Current-user credential boundary

No approved implementation plan was present in `git log main..HEAD --name-only -- docs/plans/` at the start of this task.

The canonical public user projection now lives in `packages/types/src/lib/userResponse.ts`. The previous users-package sanitizer module re-exports it so existing consumers keep the same imports. The allowlist includes `phone_extension` to preserve the public profile field when full rows become projected rows.

Both database role loaders and the user model's role loader select explicit public columns. Current-user resolution also projects its result, including API-key overrides and the revocation-checked path, so server-action exports and page props receive the same public shape. User-query actions project their single-user and list responses while retaining existing permission, tenant, portal, and interactive-user restrictions.

Authentication retains full rows through `packages/auth/src/lib/authenticateUserForAuth.ts`, guarded by `server-only`. NextAuth uses that function for its password and TOTP checks. The existing `authenticateUser` server action wraps it and returns public fields. The internal function is not exported from an action module or the auth barrel.

Review the shared allowlist and the NextAuth/internal authentication split first.

## Verification

- Full server TypeScript checking exits 2 on both this branch and clean parent `0deaba0067`, with the same seven TS2769 diagnostics: `packages/billing/src/actions/profitabilityReportActions.ts` lines 367, 690, 845, 926, 1013, and 1087, and `shared/lib/ticketChecklists/applyTemplates.ts` line 168. These failures predate the security fix. The comparison found no additional TypeScript errors introduced by this branch. See [the recorded comparison](current-user-typecheck-comparison.json).
- Builds passed for `@alga-psa/types`, `@alga-psa/auth`, and `@alga-psa/db`.
- 87 tests passed across the affected unit/contract suites, including the existing user-service sanitizer, user actions, authentication tenant scoping, revocation, development credentials, portal tenant scoping, and login win-back suites.
- Four PostgreSQL regression tests passed for ID, email, and model projections, credential preservation in storage, tenant-scoped roles/contact joins, and missing-user/type/tenant guards.
- Independent review reran 46 tests successfully: 18 across the three security/projection suites below, and 28 across `packages/auth/src/actions/auth.tenantScoping.test.ts`, `packages/auth/src/lib/getCurrentUser.test.ts`, and `packages/auth/src/lib/apiKeyUserContext.test.ts`. Builds for `@alga-psa/types`, `@alga-psa/auth`, and `@alga-psa/db` also passed during that review. Subsequent commits change only this verification evidence.
- New tests exercise runtime responses and SQL execution. Existing source-contract tests only had their moved-file paths updated.
- The app server was not started. No push or PR was performed.

Reproduce the new regression coverage from `server/`:

```sh
SKIP_DB_TESTS=0 npx vitest run src/test/unit/security/currentUserResponse.test.ts src/test/unit/security/authenticationResponse.test.ts src/test/integration/userResponseProjection.db.test.ts --coverage.enabled=false
```

The PostgreSQL suite uses the configured migrated database through `DB_HOST`, `DB_PORT`, `DB_USER_ADMIN`, `DB_PASSWORD_ADMIN`, and `TEST_DB_NAME` or `DB_NAME_SERVER`. It clones only column definitions into connection-local temporary tables, seeds those tables, and rolls the transaction back; it does not reset a database or alter saved application rows. Container secret paths can resolve through this worktree's `secrets/` directory.

## Typecheck comparison

The clean comparison used TypeScript 5.9.3 and the same installed third-party dependencies in both checkouts. In `/tmp/alga-security-parent`, `node_modules` is a local directory with third-party package links and 105 workspace links pointing into the parent checkout. No tracked parent source or configuration files were changed. A single symlink to the current branch's entire `node_modules` is unsuitable: its workspace links resolve back to the current source and mix revisions.

The current-branch command was `NODE_OPTIONS=--max-old-space-size=16384 npm run typecheck --workspace=server`. The completed parent command added `-- --listFiles`. Its file list contains 15,564 files, including 8,193 parent-local source files and the parent `userQueryActions.ts`; no source file resolves into the current worktree outside its third-party `node_modules`. Diagnostic locations, codes, and messages match. Diagnostic details also match after normalizing the displayed order of `Value | QueryBuilder<any, any>`.

Full local logs are `/tmp/current-user-review-typecheck.log` and `/tmp/current-user-clean-parent-typecheck.log`; the parent exit status is captured in `/tmp/current-user-clean-parent-typecheck.exit`. The committed comparison records the commands, revisions, diagnostics, and source-resolution audit. The earlier mixed-revision parent run is superseded by this result.

The projection location, server-only authentication accessor, missing approved plan, independent test/build results, and confirmed baseline TypeScript failures are recorded as workflow facts. The obsolete fact describing the projection as living in `packages/users` has been retired.
