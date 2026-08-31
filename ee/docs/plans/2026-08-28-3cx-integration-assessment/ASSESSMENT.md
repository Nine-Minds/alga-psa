# 3CX Integration — Assessment

Status: assessment, not scheduled · Owner: Natallia · Date: 2026-08-28
Related: [Telephony integration class](../2026-08-22-telephony-integration/PRD.md)

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

Decisions taken so far:

- Gate 3CX on the **Pro tier** behind the existing release flag. No separate
  add-on. The telephony class is currently entitled through the Microsoft
  Teams add-on, so a tier-based gate must be added beside it.
- Provider id `3cx` (code folder `threecx`). Reuse `telephony_providers` and
  `telephony_call_records`.
- Build the CRM-template path first if the integration is scheduled.

## 1. What 3CX offers

Verified against 3cx.com documentation on 2026-08-28.

| Surface | Direction | Gives us | Auth | Edition | Hosting |
| --- | --- | --- | --- | --- | --- |
| Server-side CRM integration (XML template) | PBX calls our REST API | Caller-ID lookup by number or email, free-text contact search, contact creation, call journaling when a call ends (`ReportCall`), chat journaling | None, Basic (API key), or a scripted bearer scenario | PRO and up. SMB and Basic exclude it. | Works on 3CX-hosted and self-hosted PBXs. The PBX makes outbound HTTP calls. |
| Call Control API (v20) | We call the PBX: HTTP + WebSocket at `https://<pbx>/callcontrol` | Real-time participant events (ringing, connected, ended) with `party_caller_id`, `party_did`, `callid`; `makecall`; drop, answer, divert, routeto, transferto; raw audio streams | App created in Admin Console → Integrations → API (Client ID is a DN; secret shown once). Official SDK `@3cx/call-control-sdk`. | Enterprise/AI, 8SC+ | Reachable remotely over the PBX FQDN. The older .NET localhost-only API is superseded. |
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
- `ReportCall` supplies call type (Inbound, Outbound, Missed, Notanswered), the
  external number, agent extension and email, queue extension, duration, and
  start/established/end times in UTC. It supplies no call id. We mint a
  deterministic provider call id (hash of agent, number and start time) for the
  idempotent ledger.
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
  the technician dialed from.
- `packages/telephony/src/lib/phoneNumbers.ts` and `callMatching.ts`:
  `normalizeToE164`, `phoneMatchCandidates`, `matchCallParty` (contact, then
  client, then unmatched or ambiguous).
- `packages/telephony/src/services/autoTicketFromCall.ts`, the artifact
  pipeline, and the unmatched-call queue UI.
- Tables `telephony_providers` (one row per provider with `config` jsonb and
  `webhook_secret`) and `telephony_call_records`.
- `users.phone_extension` (migration `20260818120000`): the extension-to-user
  mapping the Call Control path would need.
- Click-to-call: `packages/ui/src/components/CallLink.tsx` and
  `server/src/components/layout/MspCallLinkProvider.tsx`. A PBX dial action
  slots in beside the Teams deep link.
- Tenant resolution and secret comparison for PBX-originated requests:
  `server/src/lib/inboundWebhooks/tenantResolver.ts` and `authVerifier.ts`,
  following the `/api/inbound/[tenantSlug]/[webhookSlug]` route.
- Settings: the telephony card grid in
  `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`,
  and the provider-registry pattern in
  `packages/integrations/src/lib/rmm/providerRegistry.ts`.

Gaps a 3CX adapter exposes:

- `packages/integrations/src/actions/integrations/telephonyActions.ts` and
  `TelephonyIntegrationSettings.tsx` are shaped around one Teams card with
  hard-coded labels. They need a provider registry.
- The public v1 `contacts/search` endpoint is bound to a user API key and
  cannot filter on the normalized phone number. Thin dedicated endpoints under
  `/api/telephony/3cx/[tenantSlug]/` over `matchCallParty` are cleaner than
  bending the public API.
- Telephony is entitled through `ADD_ONS.TEAMS` in four places:
  `server/src/app/api/telephony/_ceStub.ts`,
  `packages/integrations/src/lib/telephonyAvailabilityCore.ts`,
  `IntegrationsSettingsPage.tsx`, and the jobs handler. The Pro-tier decision
  for 3CX needs a tier-based sibling gate. Whether Teams Phone stays on the
  Teams add-on is a separate decision.
- Ring-time screen pop is a stated non-goal of the telephony PRD because Graph
  cannot deliver it. 3CX Call Control can, but only on Enterprise/AI, and it
  needs a long-lived WebSocket consumer. That consumer belongs in the server
  process (started from `initializeApp`, one connection per tenant under an
  advisory lock), not in the Temporal worker.

## 3. What it would take

### Phase 1: CRM template (PRO and up)

Roughly one sprint.

- Routes: `/api/telephony/3cx/[tenantSlug]/{lookup,lookup-by-email,search,report-call}`.
  Basic auth with a per-tenant API key stored as `telephony_providers.webhook_secret`.
  Contact creation comes later; it needs a contact-create helper that is not
  bound to `withAuth`, like `interactionCreateHelper.ts`.
- One XML template generated per tenant with the base URL baked in. The API
  key is entered in the 3CX Admin Console.
- Map `ReportCall` to `CanonicalCallRecord` and hand it to
  `ingestCanonicalCall`, then the existing auto-ticket tail. Put the agent
  extension in `organizerUserId` so outbound intents attribute correctly.
- Provider card: endpoint URL, masked key with rotate, "Download template".
  All strings through `t()`.
- Tests: a template validator that parses the XML and asserts every URL and
  variable against the route constants; integration tests for the routes;
  emulator tests (section 5).

### Phase 2: Call Control (Enterprise/AI only)

One to two sprints. Only worth building when customers on Enterprise ask.

- WebSocket listener for participant events. On ringing, match the caller and
  notify the user whose `phone_extension` equals the DN.
- Click-to-call through `makecall`, recording a `telephony_call_intents` row
  so the journaled call links to the ticket.
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
   calls us.
2. If a self-hosted PBX is preferred, run the PRO trial on a small
   DigitalOcean droplet from the ISO. This is a supported path. Desktop
   hypervisors on macOS are not on the supported list.
3. Do not start the trial until phase-1 code is ready. The clock is one month.
4. Call Control and XAPI can only be validated on a customer's Enterprise
   instance or through a 3CX partner proof of concept. Treat them as
   emulator-only until one exists.

## 5. Emulator

CI needs an emulator for the same reasons the msgraph, qbo and stripe modules
exist: no Docker support, an expiring trial, and no Enterprise instance.

Shape: one module `packages/emulators/threecx` on port 4060, copied from the
stripe skeleton, registered in `suite/src/index.ts`, `build-image.sh`,
`compose.yml` and the README.

- Phase 1, PBX driver: control actions `crm-configure`, `crm-inbound-call`
  and `crm-search` that do what the 3CX CRM engine does: Basic-auth
  `GET lookup?number=…`, then `POST report-call` against our API. Both
  exchanges are recorded as a state view. Tests assert headers and JSON shape
  against the same route constants the template validator uses.
- Phase 2, Call Control surface: `POST /connect/token`, `GET /callcontrol`,
  `/callcontrol/:dn/participants`, `makecall`, the participant actions, and a
  `/callcontrol/ws` socket that pushes participant events. This needs the
  host's `serve()` hook, as smtp-sink does, because `wire()` only provides an
  Express router. `ws` is already a dependency.
- Phase 3, XAPI: `GET /xapi/v1/ReportCallLogData` and `Contacts`.
- No app environment override is needed. `pbxBaseUrl` is per-tenant config.
  Allow `http://` outside production, as `resolveTelephonyCallsWebhookUrl`
  does.

## 6. Risks and open items

- The PBX must reach our API. That is fine for SaaS tenants. A self-hosted
  AlgaPSA behind a firewall with a 3CX-hosted PBX needs an inbound path.
- Number matching: we must echo the searched number verbatim or 3CX discards
  the match.
- `ReportCall` has no call id. The deterministic hash collapses two calls from
  the same agent to the same number in the same second. Acceptable.
- Re-uploading a template restarts the CRM engine on the PBX.
- Real-time features cannot be verified without an Enterprise instance. UI
  copy must not promise screen pop until they are.

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
