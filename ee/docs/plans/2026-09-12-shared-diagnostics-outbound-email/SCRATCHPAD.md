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

