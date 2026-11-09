# Email provider security fixes: human review guide

Review this draft first for **private mail-target allowlist behavior**, **credential clearing across the IMAP config upsert transaction**, and **authorization coverage across every public action**.

## Finding 1: provider actions lacked the MSP authorization boundary

`packages/integrations/src/actions/email-actions/emailProviderActions.ts` now uses the existing `requireOutboundEmailAdmin(user, knex)` enforcement point from `mspOutboundEmailAccess.ts`. It guards `upsertEmailProvider`, `createEmailProvider` (intentionally in addition to its delegated upsert), `updateEmailProvider`, `deleteEmailProvider`, `resyncImapProvider`, `testEmailProviderConnection`, `retryMicrosoftSubscriptionRenewal`, and `getEmailProviders`. Both diagnostics actions also use that shared guard, rejecting client users before permission lookup. Writes keep their permission-denied action result; operation, renewal, listing, and diagnostics results retain their established shapes.

Behavioral coverage is in `packages/integrations/src/actions/email-actions/emailProviderActions.authorization.test.ts`. It checks client denial across all ten exports, missing `ticket_settings:update` denial across the MSP entry points, no provider-table reads for denied callers, an empty unauthorized listing, and an authorized caller reaching provider work.

## Finding 2: configurable IMAP targets could receive credentials or open internal sockets

The reusable validation core is `shared/lib/net/outboundTarget.ts`, built as `@alga-psa/shared/lib/net/outboundTarget`. It normalizes hostnames, validates syntax and scheme, rejects localhost aliases, resolves all DNS answers, and blocks loopback, private, link-local, metadata, CGNAT, and reserved IPv4/IPv6 ranges. `server/src/lib/webhooks/ssrf.ts` delegates to it while retaining the webhook API and error class.

`testEmailProviderConnection` validates the IMAP host before secret reads, OAuth refresh, or `ImapFlow` construction. It validates configurable OAuth token endpoints as HTTPS before reading credentials and uses `maxRedirects: 0`. See `docs/security/email-provider-private-target-allowlist.md` for the deployment-only `EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST` contract. Private IMAP targets are denied by default; exact host/IP entries opt in RFC 1918 IPv4 and IPv6 unique-local destinations. The allowlist cannot permit loopback, link-local/metadata, CGNAT, or reserved addresses. Token endpoints do not inherit this exception.

`persistImapConfig` compares the stored and submitted OAuth token URLs. On an actual endpoint change it deletes secret-store copies and commits `NULL` for the database `oauth_client_secret`, `refresh_token`, `access_token`, and expiry fields in the same upsert. An unchanged endpoint with omitted credential fields preserves existing database credentials. The update returns a reconnect-required `setupError` after the transaction commits, so an exception cannot roll back the clearing.

Behavioral coverage is in `packages/integrations/src/actions/email-actions/emailProviderActions.ssrf.test.ts` and `shared/lib/net/__tests__/outboundTarget.test.ts`. The database-backed merge regression is in `server/src/test/integration/emailProviderCreation.test.ts`: it verifies unchanged-endpoint preservation and persisted credential clearing after an endpoint change. Webhook and safe-fetch regressions are `server/src/lib/webhooks/__tests__/ssrf.test.ts`, `server/src/test/integration/webhookDelivery.ssrf.test.ts`, and `server/src/lib/net/__tests__/safeFetch.test.ts`.

## Verification recorded for this draft

- Affected Vitest batch: 8 files, 143 tests passed. This includes the database-backed issuer merge regression and existing webhook delivery and safe-fetch suites.
- `npm run typecheck --workspace shared`: passed.
- `npm run typecheck --workspace packages/integrations` with `NODE_OPTIONS=--max-old-space-size=8192`: passed.
- Targeted ESLint over changed TypeScript files: passed with 0 errors and 77 warnings (existing `any`/unused/global-process warnings plus test-mock `any`s).
- `npm run build --workspace shared`: passed and emitted `shared/dist/lib/net/outboundTarget.js`.
- `npx nx build @alga-psa/integrations`: passed with its dependencies. The Nx integrations target is a no-op because this package is consumed as source.
- `npx nx next:build server` with an 8 GB Node heap: passed; Next reported successful compilation and static page generation. Its configuration skips type validation.
- Server-wide `npm run typecheck --workspace server` passed with `NODE_OPTIONS=--max-old-space-size=12288`. The default 4 GB and 8 GB attempts exceeded their Node heaps.
- Direct `npm run build --workspace packages/integrations` is not a usable package command: `tsup` reports “No input files.” The Nx target is the repository-supported package target.

## Limitations and operational impact

- This is validate-then-connect, not pinned-DNS transport. A hostname can change DNS between validation and axios or IMAP resolution, leaving a DNS-rebinding TOCTOU risk for both transports.
- Private IMAP configurations stop working by default until the deployment lists their exact host or IP in `EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST`.
- Existing IMAP credentials that might have been planted before this fix are not rotated or forensically cleaned up by this change.
- Microsoft and Google fixed token endpoints are unchanged.
