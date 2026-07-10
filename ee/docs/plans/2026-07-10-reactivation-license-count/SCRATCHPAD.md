# Scratchpad - Reactivation License Count

- Plan slug: `reactivation-license-count`
- Created: `2026-07-10`

## Decisions

- 2026-07-10: Keep the count in the HMAC-authenticated request and signed token.
- 2026-07-10: Do not add a database column; the ledger stores the signed token hash.
- 2026-07-10: Login win-back uses an explicit count of one because it has no order request.

## Discoveries / Constraints

- The matching nm-store contract sends `{ email, licenseCount }` and signs
  `<email>:<licenseCount>:<timestamp>`.
- Existing tokens do not contain a count and will fail the new validation.
- The server Vitest configuration aliases `@enterprise` to CE stubs, so runtime
  request-contract coverage executes the CE shim while EE token behavior is
  tested directly.

## Commands / Runbooks

- Run focused token tests from the repository root.
- Run targeted TypeScript validation for the affected server packages.
- 2026-07-10: Focused reactivation unit suite passed 17 tests across three files.
- 2026-07-10: `tsc --noEmit -p server/tsconfig.json` passed.
- 2026-07-10: The DB-backed ledger suite was discovered but skipped all eight
  tests because a runnable local test database was not available to the suite.

## Links / References

- `ee/server/src/app/api/billing/request-reactivation/route.ts`
- `ee/server/src/app/api/billing/reactivation-token/route.ts`
- `ee/server/src/lib/billing/tenantReactivationTokens.ts`
- `ee/server/src/lib/auth/loginWinback.ts`

## Open Questions
