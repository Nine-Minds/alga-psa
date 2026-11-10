# Email provider security fixes: human review guide

Review this repair first for **private mail-target allowlist behavior in every IMAP socket path**, **durable OAuth issuer binding including environment fallbacks**, and **authorization coverage across every public action**.

## Finding 1: provider actions lacked the MSP authorization boundary

`packages/integrations/src/actions/email-actions/emailProviderActions.ts` now uses the existing `requireOutboundEmailAdmin(user, knex)` enforcement point from `mspOutboundEmailAccess.ts`. It guards `upsertEmailProvider`, `createEmailProvider` (intentionally in addition to its delegated upsert), `updateEmailProvider`, `deleteEmailProvider`, `resyncImapProvider`, `testEmailProviderConnection`, `retryMicrosoftSubscriptionRenewal`, and `getEmailProviders`. Both diagnostics actions also use that shared guard, rejecting client users before permission lookup. Writes keep their permission-denied action result; operation, renewal, listing, and diagnostics results retain their established shapes.

Behavioral coverage is in `packages/integrations/src/actions/email-actions/emailProviderActions.authorization.test.ts`. It checks client denial across all ten exports, missing `ticket_settings:update` denial across the MSP entry points, no provider-table reads for denied callers, an empty unauthorized listing, and an authorized caller reaching provider work.

## Finding 2: configurable IMAP targets could receive credentials or open internal sockets

The reusable validation core is `shared/lib/net/outboundTarget.ts`, built as `@alga-psa/shared/lib/net/outboundTarget`. It normalizes hostnames, validates syntax and scheme, rejects localhost aliases, resolves all DNS answers, and blocks loopback, private, link-local, metadata, CGNAT, and reserved IPv4/IPv6 ranges. `server/src/lib/webhooks/ssrf.ts` delegates to it while retaining the webhook API and error class.

The action, auth-paused lifecycle recovery, and inbound queue worker all use the shared IMAP host policy before OAuth refresh or `ImapFlow` construction. The shared token refresh validates HTTPS targets and sets `maxRedirects: 0`; the OAuth callback does the same. See `docs/security/email-provider-private-target-allowlist.md` for the deployment-only `EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST` contract. Private IMAP targets are denied by default; exact host/IP entries opt in RFC 1918 IPv4 and IPv6 unique-local destinations. The allowlist cannot permit loopback, link-local/metadata, CGNAT, or reserved addresses. Token endpoints do not inherit this exception.

Migration `server/migrations/20261109180000_bind_imap_oauth_credentials_to_token_endpoint.cjs` adds the issuer marker and secret-key version. It backfills existing rows once to their currently configured endpoint; rerunning the migration does not restore a marker cleared by a later change. `persistImapConfig` clears the durable `oauth_credentials_token_url` binding and commits `NULL` for database `oauth_client_secret`, `refresh_token`, `access_token`, and expiry fields on an actual endpoint change. Every consumer checks the binding before secret lookup, including cached access-token paths. Secret-store deletion is best effort because a composite provider may still expose an environment fallback. After explicit reauthorization, endpoint-scoped secret names are used; legacy fixed names are not consulted. An unchanged endpoint with omitted credential fields preserves the binding and credentials. The update returns a reconnect-required `setupError` after the transaction commits, so an exception cannot roll back the clearing.

Behavioral coverage is in `packages/integrations/src/actions/email-actions/emailProviderActions.ssrf.test.ts`, `shared/services/email/__tests__/imapOauthToken.security.test.ts`, `server/src/test/unit/email/EmailProviderLifecycleService.test.ts`, and the worker test in `server/src/test/unit/unifiedInboundEmailQueueJobProcessor.fetch.test.ts`. Database-backed regressions in `server/src/test/integration/emailProviderCreation.test.ts` verify unchanged-endpoint preservation, committed clearing, an environment fallback that remains readable after deletion but is never forwarded before or after reauthorization, and auth-paused update rejection before socket construction. Webhook and safe-fetch regressions are `server/src/lib/webhooks/__tests__/ssrf.test.ts`, `server/src/test/integration/webhookDelivery.ssrf.test.ts`, and `server/src/lib/net/__tests__/safeFetch.test.ts`.

## Verification recorded for this draft

- Final affected Vitest batch: 11 files, 177 tests passed. It includes the database-backed fallback-secret and issuer-binding regressions, lifecycle recovery, worker sockets, shared OAuth refresh, authorization, webhook delivery, and safe-fetch suites.
- Vulnerable-baseline check: the new authorization and outbound-target suites were copied into an isolated worktree at plan revision `e54c9397a9401fbfac40d2e2d2d6afcebc469732`; 9 tests failed and 1 passed, exposing the original authorization, private-target, and redirect behavior.
- `npm run typecheck --workspace shared`: passed.
- `npm run typecheck --workspace packages/integrations` with `NODE_OPTIONS=--max-old-space-size=8192`: passed.
- Targeted ESLint over changed and affected TypeScript files: passed with 0 errors and 186 warnings (mostly pre-existing `any`, unused, and Node-global warnings plus test-mock `any`s).
- `npm run build --workspace shared`: passed and emitted `shared/dist/lib/net/outboundTarget.js`.
- `npx nx build @alga-psa/integrations`: passed with its dependencies. The Nx integrations target is a no-op because this package is consumed as source.
- `npx nx next:build server` with an 8 GB Node heap: passed; Next compiled successfully in 5.6 minutes and generated 74/74 static pages. Next skips type validation and emitted 15 existing dynamic-filesystem tracing warnings.
- Final server-wide `npm run typecheck --workspace server` passed with `NODE_OPTIONS=--max-old-space-size=12288`. Earlier default 4 GB and 8 GB attempts exceeded their Node heaps.
- Direct `npm run build --workspace packages/integrations` is not a usable package command: `tsup` reports “No input files.” The Nx target is the repository-supported package target.

## Limitations and operational impact

- This is validate-then-connect, not pinned-DNS transport. A hostname can change DNS between validation and axios or IMAP resolution, leaving a DNS-rebinding TOCTOU risk for both transports.
- Private IMAP configurations stop working by default until the deployment lists their exact host or IP in `EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST`.
- The migration treats the existing token URL as the binding for legacy credentials; it cannot determine whether an endpoint was changed before this migration was deployed. Existing potentially compromised credentials are not rotated.
- Microsoft and Google fixed token endpoints are unchanged.
