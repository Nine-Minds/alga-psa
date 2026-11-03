# Current-user credential boundary

No approved implementation plan was present in `git log main..HEAD --name-only -- docs/plans/` at the start of this task.

The canonical public user projection now lives in `packages/types/src/lib/userResponse.ts`. The previous users-package sanitizer module re-exports it so existing consumers keep the same imports. The allowlist includes `phone_extension` to preserve the public profile field when full rows become projected rows.

Both database role loaders and the user model's role loader select explicit public columns. Current-user resolution also projects its result, including API-key overrides and the revocation-checked path, so server-action exports and page props receive the same public shape. User-query actions project their single-user and list responses while retaining existing permission, tenant, portal, and interactive-user restrictions.

Authentication retains full rows through `packages/auth/src/lib/authenticateUserForAuth.ts`, guarded by `server-only`. NextAuth uses that function for its password and TOTP checks. The existing `authenticateUser` server action wraps it and returns public fields. The internal function is not exported from an action module or the auth barrel.

Review the shared allowlist and the NextAuth/internal authentication split first.

## Verification

- Full server TypeScript check fails with TS2769 at `packages/billing/src/actions/profitabilityReportActions.ts` lines 367, 690, 845, 926, 1013, and 1087, and `shared/lib/ticketChecklists/applyTemplates.ts` line 168. The current revision produces these diagnostics. The parent-revision comparison was attempted at `0deaba0067` but was invalid for classification: sharing `node_modules` via a symlink caused `@alga-psa/user-composition` to resolve to the current worktree source (confirmed by `realpath`), producing additional TS2305/TS2724 errors. The parent run exited 2 and showed the same seven billing/checklist TS2769 diagnostics, but because workspace source resolution was contaminated, this does not confirm baseline status. No introduced regression has been established; a clean comparison with parent-local workspace resolution remains outstanding.
- Builds passed for `@alga-psa/types`, `@alga-psa/auth`, and `@alga-psa/db`.
- 87 tests passed across the affected unit/contract suites, including the existing user-service sanitizer, user actions, authentication tenant scoping, revocation, development credentials, portal tenant scoping, and login win-back suites.
- Four PostgreSQL regression tests passed for ID, email, and model projections, credential preservation in storage, tenant-scoped roles/contact joins, and missing-user/type/tenant guards.
- New tests exercise runtime responses and SQL execution. Existing source-contract tests only had their moved-file paths updated.
- The app server was not started. No push or PR was performed.

Reproduce the new regression coverage from `server/`:

```sh
SKIP_DB_TESTS=0 npx vitest run src/test/unit/security/currentUserResponse.test.ts src/test/unit/security/authenticationResponse.test.ts src/test/integration/userResponseProjection.db.test.ts --coverage.enabled=false
```

The PostgreSQL suite uses the configured migrated database through `DB_HOST`, `DB_PORT`, `DB_USER_ADMIN`, `DB_PASSWORD_ADMIN`, and `TEST_DB_NAME` or `DB_NAME_SERVER`. It clones only column definitions into connection-local temporary tables, seeds those tables, and rolls the transaction back; it does not reset a database or alter saved application rows. Container secret paths can resolve through this worktree's `secrets/` directory.

The initial discovery was recorded through `alga-dev workflow-add-fact`. Subsequent attempts to record the final implementation and verification facts failed with `state-unavailable: timeout`; this note preserves them for later steps.
