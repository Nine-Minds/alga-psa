# 3CX Integration — Assessment

Status: assessment, not scheduled · Owner: Natallia · Date: 2026-08-28 ·
Revised: 2026-09-02 against `main` at `188c3dc644`
Related: [Telephony integration class](../2026-08-22-telephony-integration/PRD.md)
Plan: [3CX CRM template](../2026-09-02-3cx-crm-template/PRD.md) (Phase 0 and Phase 1)

## Summary

3CX exposes three documented integration surfaces. Only one of them, the
server-side CRM template, is available on the PRO edition. The other two
(Call Control API and Configuration API) require the Enterprise/AI edition
with an 8SC+ license, which has no self-serve trial.

The CRM template maps almost one-to-one onto the telephony class that shipped
on 2026-08-22 (`packages/telephony`, Teams Phone as the first adapter). A 3CX
integration is therefore a second adapter plus a small set of REST endpoints
the PBX calls, an XML template we ship, and an emulator module for CI. It is
not a greenfield build and needs no new tables.

3CX runs in a VM, never in Docker. A PRO trial lasts one month. CI needs an
emulator.

Decisions:

- **Enterprise Edition only.** The telephony class is already refused on CE:
  `resolveTelephonyAvailability` returns `ce_unavailable`, and every route
  under `server/src/app/api/telephony/` answers 501 through `_ceStub.ts`.
  3CX inherits both. The adapter lives in a new EE package,
  `ee/packages/threecx` (`@alga-psa/ee-threecx`), which CE builds alias to
  the stub package the same way `@alga-psa/ee-microsoft-teams` is aliased in
  `server/next.config.mjs` and `server/tsconfig.json`. CE never bundles it.
- **Release flag `release-v1-6-feature`.** The 1.5 release flag and the
  telephony gate built on it were removed on 2026-08-31 (`dba55c91ab`), so
  there is no release flag to reuse. Add
  `RELEASE_V1_6_FEATURE_FLAG = 'release-v1-6-feature'` to
  `packages/core/src/lib/features.ts`. The flag gates the UI only: the 3CX
  settings card and its sub-nav entry read it through `useFeatureFlag`.
  Routes, server actions and the job handler do not read it. Entitlement is
  edition and tier; the flag controls discoverability. Teams Phone shipped in
  1.5 and stays ungated.
- **Pro tier.** Add `TIER_FEATURES.PBX_TELEPHONY` with minimum tier `pro`.
- **Gate order** on every 3CX server path: edition, then tier, then an
  active `telephony_providers` row for `3cx`. Routes, server actions and the
  job handler all call one helper. The settings card adds the flag on top.
- Provider id `3cx` (code folder `threecx`). Reuse `telephony_providers` and
  `telephony_call_records`.
- Build the CRM-template path first if the integration is scheduled.

## 1. What 3CX offers

Verified against 3cx.com documentation on 2026-08-28 and re-checked on
2026-09-02.

| Surface | Direction | Gives us | Auth | Edition | Hosting |
| --- | --- | --- | --- | --- | --- |
| Server-side CRM integration (XML template) | PBX calls our REST API | Caller-ID lookup by number or email, free-text contact search, contact creation, call journaling when a call ends (`ReportCall`), chat journaling | None, Basic (username/password or API key), OAuth2, or any header the template sets itself | PRO and up. SMB and Basic exclude it. | Works on 3CX-hosted and self-hosted PBXs. The PBX makes outbound HTTP calls. |
| Call Control API (v20) | We call the PBX: HTTP + WebSocket at `https://<pbx>/callcontrol` | Real-time participant events (ringing, connected, ended) with `party_caller_id`, `party_did`, `callid`; `makecall`; drop, answer, divert, routeto, transferto; raw audio streams | App created in Admin Console → Integrations → API (Client ID is a DN; secret shown once). Official SDK `@3cx/call-control-sdk`. | Enterprise/AI, 8SC+. The docs state it verbatim: "You must have an 8SC+ Enterprise license to use 3CX Call Control." | Reachable remotely over the PBX FQDN. The older .NET localhost-only API is superseded. |
| Configuration API (XAPI) | We call the PBX: OData REST at `/xapi/v1` | Users and extensions, phonebook, queues, CDR (`ReportCallLogData`) | OAuth2 client credentials at `/connect/token`, 60-minute tokens, OpenAPI spec published | Enterprise/AI, 8SC+ | Remote |

The CRM template is the standard way PSAs integrate with 3CX. 3CX ships
templates for ConnectWise, Freshdesk, Zendesk, HubSpot and Salesforce, and the
HaloPSA and Autotask integrations in the field are third-party templates on
the same mechanism. 3CX partners know how to upload one.

### Template facts that shape the design

- Scenario ids are reserved: an empty id is the lookup by number;
  `LookupByEmail*`, `SearchContacts*`, `CreateContactRecordFromClient`,
  `ReportCall`, `ReportChat`.
- 3CX parses lookup responses as JSON through path rules. A record only counts
  as a match when the template returns `ContactUrl` (mandatory and unique), one
  of FirstName, LastName or CompanyName, and a phone output equal to the number
  being searched. So our lookup endpoint must do the matching and echo the
  searched number back verbatim.
- 3CX matches numbers on the last N digits (`MaxLength`). We match on exact
  E.164. Doing the match on our side avoids the mismatch.
- The template decides how the caller number prefix is sent (`AsIs`, `Off`,
  `Plus`, `Zeros`). We ship `Plus`, so numbers arrive as `+<country><number>`
  whenever the PBX knows the country. Numbers that still arrive without a
  prefix are normalized with the tenant default country.
- Each scenario's `Request` element takes a `Headers` child, so the template
  can send `Authorization: Bearer <key>` with the key as a template parameter.
  That reuses our existing bearer verifier; no Basic-auth mode is needed.
- `ReportCall` supplies call type (Inbound, Outbound, Missed, Notanswered), the
  external number, agent extension and email, queue extension, duration, and
  start/established/end times in UTC. It supplies no call id. We mint a
  deterministic provider call id (hash of agent, number, call type and start
  time) for the idempotent ledger.
- The template is uploaded in the Admin Console under Settings → CRM → Server
  side. Our base URL and API key are entered there as template parameters.
  There is a Test button. Templates can be written by hand; the Windows wizard
  is optional. Re-uploading a template restarts the CRM engine on the PBX.

## 2. What the repo already has

Reusable without change:

- `packages/telephony/src/types/index.ts`: `CanonicalCallRecord`. The
  `TELEPHONY_PROVIDERS` tuple (`['teams-phone']`) gains `'3cx'`.
- `packages/telephony/src/services/ingestCanonicalCall.ts`: idempotent on
  (tenant, provider, provider_call_id), creates the `Call` interaction, and
  consumes `telephony_call_intents` to attribute outbound calls to the ticket
  the technician dialed from. Intents are matched on `provider_user_id`.
- `packages/telephony/src/lib/phoneNumbers.ts` and `callMatching.ts`:
  `normalizeToE164`, `phoneMatchCandidates`, `matchCallParty` (contact, then
  client, then unmatched or ambiguous). `resolveTenantPhoneCountryCode`
  supplies the default country for numbers without a prefix.
- `packages/telephony/src/services/autoTicketFromCall.ts`, the artifact
  pipeline, and the unmatched-call queue UI.
- Tables `telephony_providers` (one row per provider with `config` jsonb and
  `webhook_secret`) and `telephony_call_records`.
- The job path. The Teams webhook validates and enqueues
  `process-telephony-call-notification`
  (`server/src/app/api/telephony/webhooks/teams-calls/route.ts`); the handler
  in `packages/jobs/src/lib/handlers/` is edition-gated and runs ingestion and
  the auto-ticket tail off the request thread.
- Click-to-call: `packages/ui/src/components/CallLink.tsx` and
  `server/src/components/layout/MspCallLinkProvider.tsx`. A PBX dial action
  slots in beside the Teams deep link.
- PBX-originated requests: `resolveInboundWebhookTenantSlug` in
  `server/src/lib/inboundWebhooks/tenantResolver.ts` (12-hex tenant slug via
  `getTenantIdBySlug`), `verifyBearer` in `authVerifier.ts` (modes:
  `hmac_sha256`, `bearer`, `ip_allowlist`, `path_token`), and
  `rateLimitConfig.ts`, all following `/api/inbound/[tenantSlug]/[webhookSlug]`.
- Feature flags on the client: `useFeatureFlag` in `@alga-psa/ui` evaluates
  against PostHog with the tenant as a person property. Playwright runs set
  `NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=true`, which makes every flag read as
  on, and `NEXT_PUBLIC_FORCE_FEATURE_FLAGS` pins individual flags for local
  runs and card tests.
- Settings: the telephony card grid in
  `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`,
  and the provider-registry pattern in
  `packages/integrations/src/lib/rmm/providerRegistry.ts`.
- CE aliasing of EE packages: `@alga-psa/ee-microsoft-teams` resolves to
  `ee/packages/microsoft-teams/src` on EE and to `packages/ee/src` on CE
  (`server/next.config.mjs`, `server/tsconfig.json`).

Gaps a 3CX adapter exposes:

- Entitlement is edition-only today. The Teams add-on was removed on
  2026-08-27 (`ca245b90a1`) and the 1.5 release flag on 2026-08-31
  (`dba55c91ab`), so telephony has no add-on, tier or flag gate left.
  `TelephonyAvailabilityDisabledReason` still declares `feature_disabled`;
  nothing produces it, and 3CX does not either. `TIER_FEATURES.TEAMS_INTEGRATION`
  still sits in `ADD_ON_ONLY_FEATURES` (`packages/types/src/constants/tierFeatures.ts`),
  so `tierHasFeature` answers false for it on every tier. Remove that leftover
  when the new tier feature is added.
- `packages/integrations/src/actions/integrations/telephonyActions.ts` and
  `TelephonyIntegrationSettings.tsx` are shaped around one Teams card: a
  hard-coded provider label map, `setTelephonyProviderEnabled` calling
  `activateTeamsPhoneProvider` directly, and `loadEeTelephony` importing
  `@alga-psa/ee-microsoft-teams/lib`. They need a provider registry that
  imports the EE module per provider.
- The intent recorder in `telephonyActions.ts` hard-codes
  `provider: 'teams-phone'` and stores the Microsoft account id as
  `provider_user_id`. It must become provider-aware before Phase 2.
- The public v1 `contacts/search` endpoint does match on
  `normalized_phone_number`, but as a substring under a per-user API key, not
  through `matchCallParty`'s contact-then-client resolution, and it cannot echo
  the searched number. Thin dedicated endpoints under
  `/api/telephony/3cx/[tenantSlug]/` are cleaner than bending the public API.
- `users.phone_extension` (migration `20260818120000`) is the extension part
  of the user's own phone number, added beside `phone` on users, clients and
  client locations. Nothing in telephony reads it, and it cannot express one
  user on two PBXs. Phase 1 resolves the agent by the email `ReportCall`
  supplies. Phase 2 keeps an extension-to-user map in
  `telephony_providers.config` for the `3cx` row, edited on the provider card.
- Ring-time screen pop is a stated non-goal of the telephony PRD because Graph
  cannot deliver it. 3CX Call Control can, but only on Enterprise/AI, and it
  needs a long-lived WebSocket consumer. That consumer belongs in the server
  process (started from `initializeApp`, one connection per tenant under an
  advisory lock), not in the Temporal worker.
- The PRD's Gating section still describes the Teams add-on. It is superseded
  by `ca245b90a1`; this document is the current statement of telephony gating.

## 3. What it would take

### Phase 0: gates and provider registry

About half a sprint. Everything in Phase 1 depends on it.

- `RELEASE_V1_6_FEATURE_FLAG` in `packages/core/src/lib/features.ts`, and a
  provider-level availability helper layered on `getTelephonyAvailability`.
  For `3cx` it adds the tier check and returns a new `tier_required` reason.
  For `teams-phone` it adds nothing. The helper never reads the flag.
- `TIER_FEATURES.PBX_TELEPHONY` at minimum `pro`, plus the label entry in
  `AccountManagement.tsx`. Drop `TEAMS_INTEGRATION` from `ADD_ON_ONLY_FEATURES`.
- A telephony provider registry in `packages/integrations/src/lib/telephony/`,
  modelled on the RMM one: id, i18n label key, settings component, and a
  loader that dynamically imports the provider's EE module. `telephonyActions`
  and `TelephonyIntegrationSettings` read from it instead of naming Teams.
- Package scaffold `ee/packages/threecx` and the CE alias pair for
  `@alga-psa/ee-threecx` in `server/next.config.mjs` and `server/tsconfig.json`.
- Settings card visibility: `useFeatureFlag(RELEASE_V1_6_FEATURE_FLAG)` and
  the tier context hide the 3CX card when either says no. Server actions
  re-check edition, tier and provider through the helper, not the flag.

### Phase 1: CRM template (PRO and up)

One sprint after Phase 0.

- Routes: `/api/telephony/3cx/[tenantSlug]/{lookup,lookup-by-email,search,report-call}`
  under `server/src/app/api/telephony/`, edition-stubbed like the Teams
  webhook, delegating to `@alga-psa/ee-threecx`. Tenant from the slug. Auth is
  `Authorization: Bearer <key>` from the template, verified with
  `verifyBearer` against `telephony_providers.webhook_secret` on the `3cx`
  row. Unknown slug is 404; failed auth, tier or inactive provider is 403.
  Apply the inbound-webhook rate limit.
- Lookup: normalize with `normalizeToE164` and the tenant default country,
  match with `matchCallParty`, and return every candidate with `ContactUrl` as
  a stable deep link to the contact or client page, the name or company, and
  the searched number echoed verbatim in the phone output.
- `report-call`: map to `CanonicalCallRecord`. Inbound is inbound; Outbound is
  outbound; Missed and Notanswered are `missed`. `providerCallId` is a hash of agent
  email, external number, call type and `CallStartTimeUTC`. `organizerUserId`
  is the tenant user whose email matches the agent email. Enqueue a job
  carrying the record and answer 202 at once. The handler calls
  `ingestCanonicalCall` and the auto-ticket tail, mirroring what the Teams
  handler does after its Graph fetch. Outbound calls are number-matched only
  in this phase; intents arrive with Phase 2.
- One XML template generated per tenant with the base URL and slug baked in
  and `Plus` prefix handling. The API key is entered in the 3CX Admin Console
  as a template parameter. Scenarios: lookup by number, `LookupByEmail`,
  `SearchContacts`, `ReportCall`. Contact creation comes later; it needs a
  contact-create helper that is not bound to `withAuth`, like
  `interactionCreateHelper.ts`.
- Provider card: endpoint URL, masked key with rotate, "Download template",
  enable and auto-ticket toggles. All strings through `t()` in every locale.
- Tests: a template validator that parses the XML and asserts every URL,
  header and variable against the route constants; integration tests for the
  routes including the gate matrix (CE 501, tier below `pro`, inactive
  provider, bad key); a card test for flag off and flag on; emulator tests
  (section 5).

### Phase 2: Call Control (Enterprise/AI only)

One to two sprints. Only worth building when customers on Enterprise ask.

- WebSocket listener for participant events. On ringing, match the caller and
  notify the user mapped to the DN in `telephony_providers.config`.
- Click-to-call through `makecall`, recording a `telephony_call_intents` row
  with `provider: '3cx'` and the extension as `provider_user_id`, so the
  journaled call links to the ticket.
- App secret stored through the tenant secret provider, never in `config`.

### Phase 3: Configuration API (optional)

CDR backfill on a maintenance schedule using the same deterministic call id,
and phonebook push. Valuable only for Enterprise tenants.

## 4. Running 3CX for development

### Getting an instance

Start at <https://www.3cx.com/try/>. Registration takes an email code, a
phone code, a user-count bracket and a deployment method, then opens the
deployment wizard. The PRO trial requires a business email and phone
verification.

| Option | Cost and term | Runs where | CRM template | Call Control / XAPI | Notes |
| --- | --- | --- | --- | --- | --- |
| 3CX SMB (Shared) | Free | Shared instance hosted by 3CX, up to 10 users, apps and softphone only | No | No | Useful only to look at the admin UI |
| 3CX Basic (Dedicated) | Free | Self-hosted from ISO or Windows, up to 10 users, no IP phones | No | No | The legacy free self-hosted keys were retired; this is the current free dedicated tier |
| 3CX PRO (Trial) | Free, one month | On-premise or self-hosted: ISO in a VM, or DigitalOcean, AWS, Azure, GCP | Yes | No | The option that validates phase 1 |
| Hosted by 3CX (Trial) | Trial | Dedicated instance on DigitalOcean, managed by 3CX, public FQDN | Yes (PRO) | No | No VM to run. Our API must be reachable from the internet. |
| Enterprise / AI | Paid, 8SC+ | Any | Yes | Yes | No self-serve trial. 3CX staff on the forum: trials are PRO only; Enterprise needs a partner proof of concept. |

### Local mechanics

- Debian 12 only, installed from the 3CX ISO or the scripted install on a
  dedicated Debian box. Supported hypervisors: ESXi, Hyper-V, KVM, XenServer.
- Docker is unsupported. 3CX states this directly.
- On-premise installs expect an RFC 1918 network, a static IP, split DNS for
  the FQDN, and a configuration file from `www.3cx.com/install/`.
- Minimum 2 vCPU and 2 GB RAM.

### Recommendation

1. Use the hosted-by-3CX PRO trial for the first manual smoke test. It has a
   public FQDN and no VM to maintain. Expose the dev server with `cloudflared`
   or ngrok, or point the template at a staging deployment, because the PBX
   calls us. Turn the flag on for the tenant in that environment's PostHog
   project, targeted on the `tenant` person property, or the card stays
   hidden and there is no way to enable the provider or download the
   template. The routes themselves do not read the flag.
2. If a self-hosted PBX is preferred, run the PRO trial on a small
   DigitalOcean droplet from the ISO. This is a supported path. Desktop
   hypervisors on macOS are not on the supported list.
3. Do not start the trial until phase-1 code is ready. The clock is one month.
   Use it to settle the two open questions in section 6: whether transfers
   produce one `ReportCall` per agent leg, and whether editing the API-key
   parameter restarts the CRM engine.
4. Call Control and XAPI can only be validated on a customer's Enterprise
   instance or through a 3CX partner proof of concept. Treat them as
   emulator-only until one exists.

## 5. Emulator

CI needs an emulator for the same reasons the msgraph, qbo and stripe modules
exist: no Docker support, an expiring trial, and no Enterprise instance.

Shape: one module `packages/emulators/threecx` on port 4070 (4010 through 4060
are taken; xero holds 4060), copied from the stripe skeleton, registered in
`suite/src/index.ts`, the `PACKAGES` list in `build-image.sh`, `compose.yml`
and the README.

- Phase 1, PBX driver: control actions `crm-configure`, `crm-inbound-call`
  and `crm-search` that do what the 3CX CRM engine does: bearer-authenticated
  `GET lookup?number=…`, then `POST report-call` against our API. Both
  exchanges are recorded as a state view. Tests assert headers and JSON shape
  against the same route constants the template validator uses.
- Phase 2, Call Control surface: `POST /connect/token`, `GET /callcontrol`,
  `/callcontrol/:dn/participants`, `makecall`, the participant actions, and a
  `/callcontrol/ws` socket that pushes participant events. This needs the
  host's `serve()` hook, as smtp-sink does, because `wire()` only provides an
  Express router. `ws` is installed but only as a root override floor; the
  emulator package must declare it.
- Phase 3, XAPI: `GET /xapi/v1/ReportCallLogData` and `Contacts`.
- No app environment override is needed. `pbxBaseUrl` is per-tenant config.
  Allow `http://` only under an emulator-mode switch, the way
  `resolveTelephonyCallsWebhookUrl` does through `isTeamsEmulatorModeEnabled`.
- The routes do not read the flag, so emulator and gate-matrix tests need no
  flag setup. Only the card test pins it.

## 6. Risks and open items

- The PBX must reach our API. That is fine for SaaS tenants. A self-hosted
  Enterprise Edition behind a firewall with a 3CX-hosted PBX needs an inbound
  path.
- Number matching: we must echo the searched number verbatim or 3CX discards
  the match.
- `ReportCall` has no call id. The deterministic hash collapses two calls from
  the same agent to the same number with the same type in the same second.
  Acceptable. Open: if 3CX runs `ReportCall` once per agent leg, a transferred
  or queue call journals as two interactions. Confirm on the trial before
  freezing the hash inputs.
- Re-uploading a template restarts the CRM engine on the PBX. Open: whether
  editing the API-key template parameter does the same; that decides how key
  rotation is worded on the card.
- Real-time features cannot be verified without an Enterprise instance. UI
  copy must not promise screen pop until they are.
- Gate drift: routes, actions and the job handler must agree on edition,
  tier and provider state. The shared helper plus the gate-matrix test keeps
  them aligned. The flag lives only in the card, so turning it off hides 3CX
  from admins but does not stop a PBX that is already configured.

## Sources

- Call Control API guide: <https://www.3cx.com/docs/call-control-api/>
- Call Control API endpoints: <https://www.3cx.com/docs/call-control-api-endpoints/>
- Configuration API: <https://www.3cx.com/docs/configuration-rest-api/>
- XAPI tutorial: <https://github.com/3cx/xapi-tutorial>
- CRM integration guide: <https://www.3cx.com/docs/crm-integration/>
- CRM template XML reference: <https://www.3cx.com/docs/crm-template-xml-description/>
- Installing on Debian: <https://www.3cx.com/docs/manual/installing-debian-linux-pbx/>
- Trial signup: <https://www.3cx.com/try/>
- PRO edition features: <https://www.3cx.com/phone-system/pro-edition/>
- Call Control SDK: <https://github.com/3cx/call-control-sdk-ts>
- Call Control examples: <https://github.com/3cx/call-control-examples>
- Forum, free and trial options: <https://www.3cx.com/community/threads/3cx-free-options.128272/>
- Forum, remote WebSocket access: <https://www.3cx.com/community/threads/remote-websockets-w-call-control-api.136550/>
- Forum, PRO/ENT trial: <https://www.3cx.com/community/threads/trial-pro-ent-license.75437/>
