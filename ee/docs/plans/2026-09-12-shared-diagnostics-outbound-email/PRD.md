# Shared diagnostics runner and outbound email diagnostics

## Status and problem

Design draft for card `13e4b454-0b7a-4681-abce-9707b2d626dd`. Planning is complete and a first implementation draft now exists. Empirical Microsoft tenant validation has NOT been performed, so the advisory Send As/Sent Items fallback remains in force. This document records implementation decisions from the commissioning brief; it does not approve or advance a workflow step.

Outbound failures currently collapse into a connection result or an ambiguous Microsoft 403 message. Administrators cannot distinguish token consent from mailbox sending permission, see the authorizing identity, or collect provider request IDs without engineering help. Inbound Microsoft 365 and Teams already have structured diagnostics but duplicate execution machinery.

## Goals and users

MSP administrators on hosted EE and CE/on-prem installations can run a saved outbound configuration through a structured checklist, understand observed failures and uncertainty, optionally send one test message, and copy a redacted support bundle. Support engineers receive status codes and correlation IDs. Developers maintain one execution kernel used by inbound M365, Teams, and outbound.

## Non-goals

- No OAuth scope-list changes, app-only mail permissions, or changes to mailbox delivery semantics.
- No rewrite of the existing 403 message. Point administrators to diagnostics through the settings UI; preserve the provider message text.
- No changes to inbound or Teams observable reports, recommendation wording, step order, redaction options, or UI behavior beyond migration.
- No new persistence schema, background diagnostic jobs, broad telemetry system, or unrelated email refactoring.
- No claim that a draft, readable folder, or accepted send proves delivered mail.

## Design decisions

1. Extract and migrate BOTH existing consumers before implementing outbound. Outbound is the first new consumer, not another adapter-owned checklist.
2. Replace the outbound Test button in both settings surfaces with one shared Outbound Diagnostics dialog. Preserve optional test-send behavior inside it. Retain the legacy server action if other callers still need it.
3. Put a thin `runOutboundEmailDiagnostics` action next to `testOutboundEmail` in `emailSettingsActions.ts`; put orchestration and provider steps in `packages/email/src/diagnostics/`.
4. Ship `send_as_probe` as a warn-level advisory unless empirical evidence supports an authoritative probe. Do not execute draft mutations in the default advisory path.
5. Treat `sent_items_writable` as a capability assessment with explicit limits. Folder existence/readability alone cannot pass writability. This is an intentional clarification of the brief, not a hidden relaxation.

## Kernel and compatibility

Proposed files: `shared/interfaces/diagnostics.interfaces.ts`, `shared/services/diagnostics/diagnosticsRunner.ts`, and `shared/services/email/microsoftGraphDiagnostics.ts`. Final names may follow existing export conventions. Shared code must not import EE, integrations UI, tenant DB, or provider implementations.

The generic types comprise status, HTTP metadata, structured error metadata, extensible step data, and `DiagnosticsReport<TSummary>`. Preserve existing exports and Microsoft365-named aliases in `microsoft365-diagnostics.interfaces.ts`. Support transport-specific SMTP evidence without pretending SMTP response codes are HTTP status codes.

The kernel owns ordered execution, the sole runStep helper, timing, exception capture, an insertion-ordered recommendation Set, the fail > warn > pass fold (including empty/all-skip legacy pass behavior), and final report/support-bundle assembly. Step definitions receive a typed context and return outcomes; domain dependencies and early termination are expressed through that context and step-list control, not a second runner. Summary builders supply domain values. Reusable boundary policies supply error normalization, legacy step/report projection, and redacted bundle fields. These are formatting policies, not competing execution engines. No call site reimplements timing, recommendation collection, or the status fold.

Inbound compatibility must preserve exact public keys, undefined/omitted fields, titles, recommendation ordering/text, includeIdentifiers behavior, live subscription cleanup behavior, and the early missing-token report (which differs from the normal bundle). Teams compatibility must preserve string errors, `detail`, omission of step startedAt, completion-time createdAt, top-level overallStatus, and absence of summary/supportBundle. The kernel can construct an internal canonical report; compatibility projections expose the existing shapes. Reuse common step typing rather than retaining Teams' duplicate structural definition.

Move classifyGraphFailure, its request-ID header extraction dependency, and mapRecommendations into the shared Graph helper. Preserve inbound mapping verbatim via an inbound recommendation policy, while common transport advice and outbound send-scope/mailbox advice are composable. Do not leak Mail.Read/folder remediation into outbound. Preserve metadata at outbound boundaries, including already-sanitized errors and EmailProviderError.errorCode/metadata. If broader normalization would alter inbound observable results, keep its legacy projection and cover that decision with compatibility tests.

Extract small supported adapter primitives for credential inspection, token-claims decoding, authenticated identity and mailbox-path decisions. Reuse the existing OAuth refresh/persistence and send transport. Do not reach through private members or call the inbound checklist as an outbound prerequisite. In particular, inbound read/subscription health must not gate outbound sending. Reuse the tokens_present step logic with a configurable outbound projection rather than copying it.

## Outbound shell and action contract

`runOutboundEmailDiagnostics({ liveSendTest?: boolean, recipient?: string, includeIdentifiers?: boolean })` returns a typed structured report. Live send defaults false; a valid recipient is required when true. Tenant derives only from withAuth context. Enforce the existing email-settings management permission and exclude client-portal callers before settings/credential reads or network activity. Validate input server-side. Do not accept arbitrary provider credentials, tenant IDs, or network endpoints from the dialog.

Resolve settings, enabled provider, mailbox binding, and From address using the same service resolvers and selection behavior as real sending. Do not reproduce selection logic. The report must show configured ticketing From, resolved default From, and effective provider sender separately: MicrosoftGraphEmailProvider currently maps Graph `from` to its bound mailbox. An address mismatch is explanatory evidence, not a settings mutation.

The common `outbound_provider_selected` step fails for absent settings, disabled/missing providers, or invalid binding. Report safe configuration failures as steps and skip dependent work with a reason. Dispatch Microsoft, SMTP, or Resend steps using the same kernel. Do not run manager.initialize first and lose the detail before steps exist. Preserve fresh verification evidence before manager/provider wrapping.

Summary includes provider type, effective sender, authorizing identity when available, mailbox route, checked capabilities/limits, overallStatus, and live-send disposition. Every step contains timing, status, safe data/error, and actual protocol status/request IDs where available. No fabricated request IDs for local failures. Multi-operation evidence (draft create/delete, retries) retains each operation's metadata.

## Microsoft steps

| Step | Required behavior |
| --- | --- |
| outbound_provider_selected | Common shell result, Microsoft binding and effective sender visible. |
| tokens_present | Reuse shared credential step; fail missing credentials; never expose token values. Refresh through existing adapter lifecycle when needed. |
| token_claims | Decode the token actually used. Missing/opaque/non-JWT/no scp means warn with “token could not be decoded” or an equally explicit scopes-unavailable reason, never pass. A decodable delegated token missing Mail.Send fails and recommends reconnection. Require Mail.Send.Shared only for a confirmed different sending mailbox. |
| graph_me | Report the authenticated user's identity and HTTP evidence. Failure does not imply consent passed. |
| mailbox_base_path | Show the production `/me` versus `/users/{mailbox}` decision and reason. Different mailbox: explain delegated/shared sending and Exchange Send As for the intended sender identity; include mailbox access caveats. Unknown identity remains unknown, not proof of delegation. |
| send_as_probe | Default warn advisory for shared/delegated sending; skip as not applicable for confirmed self-send. State that Exchange Send As has not been verified. A draft probe cannot pass this step as authoritative without the validation gate below. |
| sent_items_writable | Explain saveToSentItems=true and the actual target mailbox. A safe folder lookup may report accessibility metadata, but keep writability unverified at warn unless evidence actually establishes it. A lookup 403 is an access-check failure, not proof sendMail cannot save. |
| live_send_test | Skip by default. When opted in, send one test through the enabled provider and production mapping, retaining Graph code/status/IDs. 202 means accepted, not delivered. No diagnostic-level automatic resend after an uncertain result; preserve provider reconciliation flags. |

Identity is a dependency of the conditional shared scope requirement. Resolve identity before finalizing token_claims, then emit the documented display order (or use a context preflight with its own graph_me outcome). Avoid a duplicate `/me` call merely to achieve ordering. Claim decoding is diagnostic evidence, not token signature validation. Re-evaluate scope evidence if OAuth refresh changes the access token; do not report consent for a stale token.

Diagnosis must distinguish: known missing scopes; explicit send-permission denial such as ErrorSendAsDenied; generic access denied with multiple possible causes; and unknown token consent. An actual send-specific denial names Exchange Send As/send-on-behalf permission denial and cites provider status and request-id. Generic 403 alone must never be labeled confirmed missing Send As. Send on Behalf is a distinct Exchange configuration and should not be misrepresented as equivalent sender appearance.

## Probe evidence gate and acceptance reconciliation

Microsoft's [draft-create API](https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0) requires Mail.ReadWrite. The current OAuth list requests read and send scopes, not write scopes. A draft-create failure therefore does not isolate Send As. Do not add scopes to make the probe possible.

Microsoft's [sending from another user documentation](https://learn.microsoft.com/en-us/graph/outlook-send-mail-from-other-user) separates Graph consent from Exchange Send As/Send on Behalf and documents Full Access for the target-mailbox send route. Its explicit denial example uses ErrorSendAsDenied. Inference for this design: an ordinary 403 or a successful draft is insufficient evidence of the precise Exchange permission state.

Microsoft's [permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) states Mail.Send can save Sent Items without Mail.ReadWrite. Consequently, lack of independent write-probe permission must not fail outbound send capability.

Before promoting a draft probe, run a controlled real-tenant matrix: self mailbox; delegated mailbox with full access but no Send As/Send on Behalf; with Send As; with Send on Behalf only; without full access; missing send scopes; and with/without write scopes already consented. Compare draft-create-with-from/delete against actual sendMail on the same route/token, recording status/code/IDs, known Exchange grants, and propagation timing. Never record credentials or tenant-scoped identifiers in plan artifacts.

If explored, create only a synthetic draft, keep its returned ID, delete that specific draft in finally, and report cleanup failure independently. Never enumerate/delete unrelated drafts. Such experiments and actual sends require an authorized test tenant and recipient; this planning assignment performs none.

If the matrix shows a false pass, conflated permission denial, or is unavailable, retain advisory behavior. The brief explicitly allows that fallback. Its stronger acceptance (“no-send report definitively names Send As with Graph evidence”) is conditional on viable evidence and cannot honestly be promised today. The shippable fallback distinguishes known missing scopes from unverified Exchange permission, and the optional live send exposes actual send-specific denial. Record the chosen outcome before acceptance signoff; do not mark empirical validation passed based on mocks.

## SMTP and Resend

SMTP: reuse the actual transport configuration and one verify() attempt. Expose connection, TLS, and AUTH steps with evidence from supported transport results/errors. Capture native code, responseCode, response, command and safe connection details before INIT_FAILED wrapping. A successful full verify supports connection and configured AUTH completion; TLS passes only when negotiated transport evidence establishes it, not simply because TLS was configured. Disabled TLS or absent AUTH is explicitly not tested/not applicable. On failure, identify the supported failing phase; later phases skip. Unknown phase remains unverified instead of manufacturing preceding passes. Timings must reflect observed stages or clearly identify the shared verification duration. Avoid parsing sensitive SMTP transcripts or logging AUTH payloads.

Resend: validate required configuration and run the provider's real verification (`GET /domains`). Bypass verification cache for an explicit diagnostic check or label cached evidence and its age. Preserve HTTP status and IDs where exposed. A restricted key's domains denial is a domains-check denial, not proof that sending is forbidden. Do not invent a send-capability check; use the common optional live send for actual send evidence.

## UI and support bundle

Create `OutboundEmailDiagnosticsDialog.tsx` under integrations email/admin and export it for both CE EmailSettings and EE ManagedEmailSettings. Use existing Dialog, status, input and button components, translations, unique interactive IDs, and theme tokens. Display a saved-settings explanation, effective sender/authorizing user, status rows, durations, expanders for safe protocol details, recommendations, and copy/download support bundle. Warn means inconclusive or attention needed, not success.

Opening/running default diagnostics sends no message. Live-send opt-in reveals a recipient field and an explicit send action; validate before invoking the server. Disable repeated submission during a run and make outcomes available in the same report. Unsaved changes are labeled as not included. Action/transport errors render safely with a retry path; diagnostic failures remain in report rows.

An authorized admin can see operational mailbox identities in the dialog. Export defaults to identifier redaction; any includeIdentifiers option remains explicit and never includes secrets. Use safe field projection/redaction for nested data, Graph paths, response bodies and recommendations. Preserve status codes and Microsoft request IDs. Never serialize OAuth/API/SMTP secrets, Authorization headers, raw Axios config, full JWTs or mail content. No new stored report table.

## Notification logging

At the existing sendEventEmail failure log, add explicit errorCode, status from metadata.status, and requestId from metadata.requestId. Safely handle ordinary Error and non-Error throws, preserve the existing disabled-service behavior and rethrow. Do not depend on the logger serializing the raw error's non-enumerable/provider-specific properties. Do not dump entire metadata or change the 403 message.

## Delivery sequence

1. Characterize inbound/Teams reports and extract shared types/kernel/Graph helpers; migrate both. Existing regression suites and report comparisons gate the next phase.
2. Implement outbound shell, settings/action boundary, shared Microsoft primitives, and provider step sets; retain advisory probe decision by default.
3. Add shared dialog to both settings surfaces and optional live send. Add the small notification log fix.
4. Run automated coverage, DB-backed tenant resolution guards, CE/EE UI smoke checks and the authorized empirical matrix if available. Record evidence and limitations. No schema migration or feature flag is required.

## Definition of done

- All three consumers call the same kernel. Search for both `const runStep =` and `function runStep` finds no diagnostics execution clones outside it; review folds and bundle assembly too.
- Existing inbound and Teams tests pass with matching normalized before/after reports and unchanged public types/UI.
- Scope and identity uncertainty is visible. Missing Mail.Send and send-specific Exchange denial are visibly different; all available protocol IDs survive into the report and export.
- SMTP failures preserve real connection/TLS/AUTH evidence; Resend only claims checks actually performed.
- Default diagnostics sends no mail; optional test sends once through the selected provider; both CE/EE surfaces expose the dialog.
- Reports/bundles do not expose credentials; unauthorized/cross-tenant calls cannot inspect settings or trigger diagnostics.
- Notification failure logs explicitly contain errorCode/status/requestId.
- Empirical probe evidence or advisory fallback is recorded honestly, with no unsupported Send As/Sent Items verdict.
