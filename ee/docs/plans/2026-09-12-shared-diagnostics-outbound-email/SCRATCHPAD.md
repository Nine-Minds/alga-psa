# Shared diagnostics and outbound email — scratchpad

## Commission and scope

- Planning assignment for workflow card `13e4b454-0b7a-4681-abce-9707b2d626dd`, Design Session. Read live card and active facts with `alga-dev workflow-get-project` / `workflow-list-facts` on 2026-09-12 local time.
- Deliver four synchronized planning artifacts only. Do not advance the board, implement, merge, or deploy.
- Existing unrelated `package-lock.json` modification predates this assignment; preserve it.
- Plan estimate: approximately 30 atomic features, with fewer representative tests.

## Initial findings

- Inbound runner captures startedAt, duration, structured errors and HTTP metadata; early missing-token return has a different support bundle from its full report.
- Teams runner has string errors and detail, no startedAt on steps, a top-level overallStatus and no supportBundle. Migration must preserve these differences via boundary projections, without duplicating execution or status folds.
- SMTP createTransport calls verify(), then initialize wraps errors. Collect native evidence before wrapping.
- Resend verifyConnection uses GET /domains with a provider-id verification cache; report cache use or explicitly refresh, never call cached state a fresh network check.
- The old test action is withAuth-wrapped; new diagnostics must explicitly enforce email-settings management permission and derive tenant from session.

## Decisions in progress

- Replace both outbound Test entry points with one shared dialog; explicit live-send opt-in and recipient.
- Draft creation and Sent Items access are not proof of Send As or sendMail capability. Preserve advisory fallback until empirical evidence exists.

## Final planning decisions and evidence

- Created PRD, 29 feature items and 17 representative test items. All implementation flags remain false. The request authorizes a complete draft plan; no separate scope confirmation or board mutation was needed to produce it.
- Microsoft provider maps Graph message.from to its bound mailbox (`MicrosoftGraphEmailProvider.ts:233`); display effective sender separately from ticketing/default From.
- Existing scope list is Mail.Read, Mail.Read.Shared, Mail.Send, Mail.Send.Shared, User.Read and offline_access. No write scope. Draft-create requires write permission; default send_as_probe therefore remains advisory with no mutation. sent_items_writable must also describe evidence limits.
- Primary references checked during planning: https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0 ; https://learn.microsoft.com/en-us/graph/outlook-send-mail-from-other-user ; https://learn.microsoft.com/en-us/graph/permissions-reference . PRD records sourced facts separately from design inference.
- No real Microsoft tenant probe, SMTP verification, Resend request, or live send was performed. Empirical results are an implementation validation gate; advisory fallback is already allowed by the card.
- Strong Send As acceptance is conditional: generic HTTP 403 cannot prove a single Exchange cause. Explicit send-denial evidence can name the permission; otherwise show uncertainty and the next admin action.
- SMTP verify returns combined success/failure; do not fabricate stage timing or TLS negotiation. Preserve native error metadata before wrapping. Resend's domains capability may differ from a restricted key's send capability.

## Implementation navigation

- shared/interfaces/microsoft365-diagnostics.interfaces.ts
- shared/services/email/providers/MicrosoftGraphAdapter.ts (private path helper, sendMail, classifyGraphFailure, runMicrosoft365Diagnostics)
- shared/services/email/providers/__tests__/MicrosoftGraphAdapter.diagnostics.test.ts
- shared/services/email/microsoftGraphEndpoints.ts
- ee/packages/microsoft-teams/src/lib/actions/integrations/teamsDiagnosticsActions.ts
- server/src/test/unit/lib/teams/actions/teamsDiagnosticsActions.test.ts
- packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.diagnostics.test.tsx
- packages/email/src/TenantEmailService.ts and providers/{MicrosoftGraphEmailProvider,SMTPEmailProvider,ResendEmailProvider}.ts
- packages/integrations/src/actions/email-actions/emailSettingsActions.ts
- packages/integrations/src/components/email/admin/{EmailSettings,Microsoft365DiagnosticsDialog}.tsx
- ee/server/src/components/settings/email/ManagedEmailSettings.tsx
- server/src/lib/notifications/sendEventEmail.ts

## Validation and handoff

- Validate artifacts: `python3 scripts/validate_plan.py ee/docs/plans/2026-09-12-shared-diagnostics-outbound-email`.
- Existing test configs include shared/vitest.config.ts, server/vitest.workspace-unit.config.ts, server/vitest.workspace-db.config.ts and server/vitest.server-colocated.config.ts. Choose the owning workspace/config when implementing; do not assume one root Vitest invocation discovers all suites.
- Read applicable integration-testing skill before authoring DB-backed tests; existing planning artifact is not evidence that application tests have run.
- Board actions remain with XO/captain. Return plan path in assignment envelope; do not mark Design Session complete or advance it.

## Draft implementation notes (2026-09-13)

- Kernel: `shared/interfaces/diagnostics.interfaces.ts` (generic types) and `shared/services/diagnostics/diagnosticsRunner.ts` (`runDiagnosticsSteps`, `computeOverallStatus`, `assembleDiagnosticsReport`, `defaultErrorMeta`). The sole `const runStep =` / `function runStep` diagnostics clones are gone; remaining grep hits are unrelated (emulator scenario runner, Temporal product-upgrade workflow, historical plan docs).
- Graph helper: `shared/services/email/microsoftGraphDiagnostics.ts` owns `classifyGraphFailure`, `extractGraphIds`, `toDiagnosticsErrorMeta`, `mapInboundRecommendations` (verbatim) and composable `mapOutboundRecommendations` (no Mail.Read/folder advice).
- Migrated consumers: `MicrosoftGraphAdapter.runMicrosoft365Diagnostics` and Teams `runTeamsDiagnosticsImpl` both call the kernel. Teams projects kernel steps back to string errors + `detail` + no `startedAt`, and stamps `createdAt` at completion.
- Outbound: `packages/email/src/diagnostics/` holds the provider-dispatched runner (`outboundDiagnostics.ts`), Microsoft/SMTP/Resend step sets, types and redaction. Provider selection and runtime config reuse `EmailProviderManager.resolveProviderConfig` (now public) so Microsoft mailbox binding and Resend secret fallbacks match real sending. The action `runOutboundEmailDiagnostics` sits beside `testOutboundEmail` in `emailSettingsActions.ts`, derives tenant from the session, rejects client users and requires `ticket_settings:update`.
- Shared dialog `OutboundEmailDiagnosticsDialog.tsx` replaces the Test button in CE `EmailSettings.tsx` and EE `ManagedEmailSettings.tsx`.
- Build note: the new shared modules were added to `shared/tsup.config.ts` entries; without this, `packages/email` (which bundles `@alga-psa/shared` through the dist exports map) could not resolve them at build/runtime.
- Advisory fallback retained: no `send_as_probe` mutation and no `sent_items_writable` verdict; both stay warn/limit-described. F016/T009 empirical matrix not run.
- Verification run: shared `vitest` (inbound adapter diagnostics + new kernel/graph suites), email `tsup` build and `vitest` (new diagnostics suites), integrations `vitest` (Teams diagnostics component + EmailSettings/actions), server `vitest` (Teams action suite + notification logger suite + EE ManagedEmailSettings suite), and `tsc --noEmit` for shared/email/integrations/server/ee-server. Server typecheck OOMs at the default and 8 GB heaps; it completed with an empty log at `--max-old-space-size=24576`.
- Known gaps: no DB-backed happy/guard integration tests (T005/T006), no authoritative real-tenant probe (T009), no direct rendered-dialog unit test (T013) and no manual UI smoke (T017). New dialog i18n keys ship with inline `defaultValue` and are not yet in locale bundles.

## Draft repair notes (2026-09-13, continuation)

- Kept the interrupted repair pass: `decodeCurrentAccessTokenClaims` now returns `scopesAvailable` so a decoded token with no usable `scp` warns instead of implying consent; `getMailboxRoute` is tri-state (`self`/`shared`/`unknown`); outbound failures normalize already-sanitized/`EmailProviderError` status/code/request-id/client-request-id; live-send failures route through `mapOutboundRecommendations`, which distinguishes `ErrorSendAsDenied`/`ErrorSendOnBehalfDenied` from a generic 403; SMTP classifies the real failed phase instead of treating every 5xx as AUTH; report/export use explicit safe projections (secrets and raw response bodies dropped, protocol ids kept).
- Closed coverage gaps: added `packages/email/src/diagnostics/__tests__/outboundDiagnostics.db.test.ts` (T005/T006 tenant settings read + provider selection against the dev database, opt-in via `OUTBOUND_DIAG_DB_TESTS=1`), `OutboundEmailDiagnosticsDialog.test.tsx` (T013), CE entry-point assertion in `EmailSettings.test.tsx`, and the action authorization boundary test `emailSettingsActions.outboundDiagnostics.test.ts` (client/no-permission/invalid-recipient guards). Added the `ErrorSendAsDenied` vs generic-403 live-send matrix and the decoded-no-scp warn to the outbound suites; extended the shared Graph helper suite.
- i18n: added the `outboundDiagnostics` block and `managed.outbound.diagnosticsButton` to all 8 real locales, regenerated xx/yy pseudo-locales, and ran the full `test:i18n` gate (parity, glossary, untranslated) green.
- Verification run: shared kernel/graph/adapter diagnostics; email diagnostics (incl. DB test with `OUTBOUND_DIAG_DB_TESTS=1`); integrations dialog/entry/action suites and the Teams diagnostics component; server Teams action, notification logger and EmailSettings suites; EE ManagedEmailSettings suite. `tsc --noEmit` for shared/email/integrations and server (`--max-old-space-size=24576`) and EE (`--max-old-space-size=16384`) all exit 0 with empty logs. `shared` and `packages/email` tsup builds succeed.
- Remaining honest gaps: T009/F016 real-tenant Send As matrix was NOT run (no authorized tenant/recipient), so `send_as_probe`/`sent_items_writable` stay warn-level advisories. T017 authenticated UI smoke is not done: the running server rotates the seeded `glinda@emeraldcity.oz` password per boot and the current banner is not captured, so only the unauthenticated render smoke (signin page renders with zero console errors on port 3424) plus the automated CE/EE entry tests were possible. `runStep` search confirms only the kernel plus unrelated emulator/Temporal helpers; `GmailDiagnosticsService` keeps its own value-returning recorder and all-skip fold by design and is intentionally out of scope for this card.

## Review fixes (2026-09-13, second pass)

- Effective sender now reuses `resolveDefaultFromAddress(settings, tenantCompanyName)` for SMTP/Resend (provider From + `defaultFromDomain` rewrite + address parsing + resolved display name), the same helper the real test send uses; Microsoft keeps the bound mailbox but carries the resolved display name. `effectiveSenderName` flows to the report, the live-send `fromName` and the dialog. Covered by tests using a formatted `"Support Team" <support@example.test>` From with a differing default domain.
- Live-send evidence survives the real provider boundaries: `MicrosoftGraphAdapter.toSanitizedGraphError` now keeps `clientRequestId`; `MicrosoftGraphEmailProvider.toProviderError` carries it into `EmailProviderError.metadata`; `SMTPEmailProvider.sendEmail` keeps `responseCode`/`status`/`command`/`response` (server text only, never the AUTH payload). `liveSendResultFromEmailSendResult` maps the production `EmailSendResult` onto the diagnostics result and is exercised by a test that runs the real SMTP provider wrapper. Live-send/onError advice is provider-specific (SMTP auth/TLS/connection, Resend key/domain) rather than Graph advice for every provider.
- `smtp_tls` reports TLS as negotiated when a required-TLS `verify()` later fails at AUTH (supported ordering evidence), and leaves TLS unverified for connection/unknown failures; `smtp_auth` names the preceding phase. Added required-TLS+AUTH-failure and connection-failure coverage.
- Teams `TeamsDiagnosticsStep`/`TeamsDiagnosticsStatus` now derive from the shared kernel types (only `detail`/string `error` remain Teams-specific); inbound `tokens_present` reuses `inspectStoredCredentials` while projecting the legacy inbound data fields.
- `tsc --noEmit` re-run clean for shared/email/integrations and server/EE at the documented heap limits; shared and email tsup builds succeed.
- SMTP live-send advice classifies only from native evidence (`errorCode`, `command`, `responseCode`, sanitized server `response`) with explicit protocol precedence: TLS, then AUTH, then connection, then 5xx recipient/message rejection. The provider's generic remediation text (which always names credentials/TLS) is never treated as evidence, so EENVELOPE/550, ECONNREFUSED and ETLS no longer surface as AUTH failures. Real-SMTP-provider-through-report regression cases cover all four classes.

