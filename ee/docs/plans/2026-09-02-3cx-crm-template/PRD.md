# PRD — 3CX CRM Template Integration

- Slug: `2026-09-02-3cx-crm-template`
- Date: `2026-09-02`
- Status: Draft
- Decision record: [3CX assessment](../2026-08-28-3cx-integration-assessment/ASSESSMENT.md)
- Parent class: [Telephony integration](../2026-08-22-telephony-integration/PRD.md)

## Summary

A 3CX PBX looks up callers in AlgaPSA and journals finished calls into it
through 3CX's server-side CRM template. This is the second adapter on the
telephony class after Teams Phone. It reuses the call ledger, the number
matcher, the `Call` interaction, auto-ticketing and the unmatched queue
without change. Scope is Phase 0 (gates and provider registry) and Phase 1
(CRM template) of the assessment. Call Control and the Configuration API are
out.

## Problem

MSPs on 3CX PRO want the caller's name in the 3CX client when the phone rings
and a `Call` interaction on the contact after hangup. Today only Teams Phone
does this. The telephony settings and actions are shaped around one Teams
card, and telephony has no tier gate since the Teams add-on was removed.

## Goals

- An admin uploads one template, enters one key, and calls journal.
- Lookup by number, lookup by email and free-text search work from the 3CX
  client.
- The ledger, matcher, interaction, auto-ticket and unmatched-queue paths are
  reused as they are.
- Enterprise Edition only. Pro tier. The settings card sits behind the
  `release-v1-6-feature` flag.
- The emulator covers the whole loop so CI never needs a PBX.

## Non-goals

- Call Control: ring-time screen pop, click-to-call through `makecall`.
- Configuration API: CDR backfill, phonebook push.
- Contact creation from the 3CX client, chat journaling, transcripts.
- Any change to how Teams Phone is gated or behaves.
- Community Edition availability.

## Users and Primary Flows

- **MSP admin**: turns 3CX on in Integrations settings, copies the endpoint,
  downloads the template, uploads it in the 3CX Admin Console, enters the
  key, presses Test.
- **Technician**: sees the caller's name in the 3CX client, and after hangup
  finds a `Call` interaction on the contact. A ticket exists when auto-ticket
  is on. Unknown callers wait in the unmatched queue.

1. Inbound call from a known number: lookup returns the contact; after hangup
   `report-call` journals it; the interaction lands on the contact and client.
2. Inbound call from an unknown number: lookup returns nothing; `report-call`
   lands the call in the unmatched queue.
3. Outbound call: the 3CX client dials; `report-call` journals it as outbound,
   matched by number.
4. Search: the technician types a name or company in the 3CX client and picks
   a contact.
5. Key rotation: the admin rotates the key on the card and updates the
   template parameter in the 3CX console.

## UX / UI Notes

- The 3CX card is a provider entry inside the telephony section of
  Integrations settings, beside Teams Phone. The section is rendered by
  `TelephonyIntegrationSettings.tsx` from the provider registry.
- The card shows: status badge, Enable toggle, Auto-create tickets toggle,
  the endpoint base URL with a copy button, the API key masked to its last
  four characters with a Rotate button, and a Download template button.
- The key is shown in full once, right after generation or rotation, with a
  copy button and a warning that it will not be shown again.
- The card is hidden when the flag is off, when the tenant's tier lacks
  `PBX_TELEPHONY`, or on CE. Server actions refuse on tier and edition and
  return the existing availability messages.
- Every string goes through `t()` under
  `integrations.telephony.providers.threecx.*`.
- Every interactive element carries a kebab-case `id`.

## Requirements

### Functional Requirements

**FR1 Gates.**

- `RELEASE_V1_6_FEATURE_FLAG = 'release-v1-6-feature'` exported from
  `packages/core/src/lib/features.ts`. Only the card reads it, through
  `useFeatureFlag` from `@alga-psa/ui`.
- `TIER_FEATURES.PBX_TELEPHONY` with `FEATURE_MINIMUM_TIER` of `pro`, a label
  entry in `ee/server/src/components/settings/account/AccountManagement.tsx`,
  and `TEAMS_INTEGRATION` removed from `ADD_ON_ONLY_FEATURES`.
- `getTelephonyProviderAvailability(provider, { tenantId, userId })` in
  `packages/integrations/src/lib/telephonyAvailability.ts`. It calls
  `getTelephonyAvailability` first. For `3cx` it then resolves the tenant
  tier with `resolveTenantTier` from `@alga-psa/licensing` and checks
  `tierHasFeature(tier, TIER_FEATURES.PBX_TELEPHONY)`, returning a new
  `tier_required` reason with its message when it fails. For `teams-phone`
  it adds nothing. It never reads the flag.
- Routes, server actions and the job handler use that helper. Order: edition,
  tier, then an active `telephony_providers` row for `3cx`.

**FR2 Provider registry.**

- `TELEPHONY_PROVIDERS` becomes `['teams-phone', '3cx']`.
- `packages/integrations/src/lib/telephony/providerRegistry.ts` lists one
  entry per provider: `id`, `labelKey`, `descriptionKey`, `requiresTierFeature`
  (`PBX_TELEPHONY` for `3cx`, none for Teams), `releaseFlag`
  (`RELEASE_V1_6_FEATURE_FLAG` for `3cx`, none for Teams), and `loadEe()`
  which dynamically imports the provider's EE module.
- `getTelephonyOverview` returns one `TelephonyProviderCard` per registry
  entry, with a `providerAvailability` field carrying the helper's result.
- `setTelephonyProviderEnabled` and `setTelephonyAutoCreateTickets` dispatch
  through the registry entry's EE module instead of naming Teams.
- `TelephonyIntegrationSettings.tsx` renders cards from the overview and takes
  labels from the registry's i18n keys. The Teams card looks and behaves as
  it does today.

**FR3 EE package.**

- `ee/packages/threecx` publishes `@alga-psa/ee-threecx` with a `lib` entry
  exporting: `getThreecxProviderState`, `activateThreecxProvider`,
  `deactivateThreecxProvider`, `rotateThreecxApiKey`,
  `setThreecxAutoCreateTickets`, `renderThreecxTemplate`, the route handlers,
  and the route constants.
- `server/next.config.mjs` and `server/tsconfig.json` alias
  `@alga-psa/ee-threecx` and `@alga-psa/ee-threecx/*` to the package on EE
  and to `packages/ee/src` on CE, mirroring `@alga-psa/ee-microsoft-teams`.
- The registry's `loadEe()` for `3cx` is `import('@alga-psa/ee-threecx/lib')`.

**FR4 Provider state.**

- Activation upserts the `3cx` row in `telephony_providers` with
  `status: 'active'` and, when `webhook_secret` is null, a fresh key: 32
  random bytes, base64url, no padding.
- Deactivation sets `status: 'disabled'`. The key is kept.
- Rotation writes a new key and `config.keyRotatedAt`. The old key stops
  working at once.
- `config` for the `3cx` row is `{ templateVersion: number, keyRotatedAt: string | null }`.
- The activate, deactivate and rotate actions return the full key only on the
  call that generated it.

**FR5 Routes.** Base path `/api/telephony/3cx/[tenantSlug]/`, files under
`server/src/app/api/telephony/3cx/`, each guarded with `isEnterpriseEdition`
from `_ceStub.ts` and delegating to the EE package. Route paths and query
parameter names live in one constants module the template renderer, the
validator test and the emulator all import.

| Route | Method | Input | Success |
| --- | --- | --- | --- |
| `lookup` | GET | `number` | 200 `{ "contacts": [Contact] }` |
| `lookup-by-email` | GET | `email` | 200 `{ "contacts": [Contact] }` |
| `search` | GET | `q` | 200 `{ "contacts": [Contact] }`, at most 20 |
| `report-call` | POST | JSON body below | 202 `{ "accepted": true, "providerCallId": "<hex>" }` |

`Contact` is `{ contactUrl, firstName, lastName, companyName, email, phone }`.
`contactUrl` is `<baseUrl>/msp/contacts/<contact_id>` for a contact match and
`<baseUrl>/msp/clients/<client_id>` for a client-only match. For `lookup`,
`phone` is the `number` query value echoed verbatim. For the other two it is
the contact's primary number in E.164.

`report-call` body:
`{ callType, number, agentExtension, agentEmail, queueExtension, durationSeconds, startTimeUtc, establishedTimeUtc, endTimeUtc }`.
`callType` is one of `Inbound`, `Outbound`, `Missed`, `Notanswered`. Times
are ISO 8601 UTC. `establishedTimeUtc` and `queueExtension` may be empty.

Processing order on every route: resolve the slug with
`resolveInboundWebhookTenantSlug` (404 `{ "error": "unknown_tenant" }` when
null); apply the inbound-webhook rate limit; load the `3cx` provider row;
verify `Authorization: Bearer <key>` with `verifyBearer` against
`webhook_secret` (403 `{ "error": "forbidden" }`); run
`getTelephonyProviderAvailability` (403 on any disabled reason); refuse when
the row is not `active` (403). Invalid or missing parameters are 400
`{ "error": "invalid_request" }`. CE answers 501 through `eeUnavailable()`.

**FR6 Lookup and search.**

- `lookup` normalizes `number` with `normalizeToE164` using
  `resolveTenantPhoneCountryCode`, then calls `matchCallParty`. A `matched`
  result returns one `Contact`. An `ambiguous` result returns every
  candidate. `unmatched` returns an empty array.
- `lookup-by-email` matches `contacts.email` case-insensitively within the
  tenant.
- `search` matches first name, last name, company name, email and normalized
  phone digits with a case-insensitive substring, ordered by name, limited to
  20.
- All three exclude inactive contacts.

**FR7 Report-call.**

Mapping to `CanonicalCallRecord`:

| Field | Value |
| --- | --- |
| `provider` | `'3cx'` |
| `providerCallId` | SHA-256 hex of `agentEmail.toLowerCase() + '|' + numberE164OrRaw + '|' + callType + '|' + startTimeUtc` |
| `direction` | `Inbound` → `inbound`; `Outbound` → `outbound`; `Missed`, `Notanswered` → `missed` |
| `callerNumber` / `calleeNumber` | `number` as `{ raw, e164 }` on the caller side for inbound and missed, on the callee side for outbound |
| `organizerUserId` | `users.user_id` where `email` equals `agentEmail` case-insensitively within the tenant, else `null` |
| `startedAt`, `endedAt` | `startTimeUtc`, `endTimeUtc` |
| `durationSeconds` | `durationSeconds`, `0` for missed |
| `modality` | `'audio'` |
| `raw` | the full body |

- The route validates, builds the record, enqueues
  `process-telephony-canonical-call` with `{ tenantId, record }`, and answers
  202. It does no other database work.
- The job is registered in `server/src/lib/jobs/registerAllHandlers.ts`
  beside `process-telephony-call-notification`, with the same retry policy
  and edition gate. The handler runs `ingestCanonicalCall` and then the same
  auto-ticket and notification tail the Teams handler runs after ingestion.
  That tail is extracted into one function both handlers call.
- A second `report-call` with the same hash inputs creates nothing new.

**FR8 Template.**

- `renderThreecxTemplate({ baseUrl, tenantSlug, templateVersion, country })`
  returns the XML string. It reads the route constants, so a route rename
  breaks the validator test rather than the template.
- Template contents: `Name="AlgaPSA"`, `Version`, `Country` from the tenant
  default country, one `Parameter` named `ApiKey` of type password, number
  prefix `Plus`, and four scenarios: lookup by number (empty Id),
  `LookupByEmail`, `SearchContacts`, `ReportCall`. Each request carries
  `Authorization: Bearer [ApiKey]`. Outputs map `contactUrl` to `ContactUrl`,
  `firstName`, `lastName`, `companyName`, `email`, and `phone` to
  `PhoneBusiness`.
- The Download template action streams the rendered XML as
  `algapsa-3cx-<tenantSlug>.xml`. It requires the same permission as the
  toggles.

**FR9 Settings card.** As described under UX / UI Notes, driven by the
registry entry: hidden unless `useFeatureFlag(entry.releaseFlag)` and
`useTier().hasFeature(entry.requiresTierFeature)` both pass.

**FR10 Emulator.** Package `packages/emulators/threecx`, id `threecx`, port
4070, copied from the stripe skeleton and registered in `suite/src/index.ts`,
the `PACKAGES` list in `build-image.sh`, `compose.yml` and the README.

- Action `crm-configure { baseUrl, tenantSlug, apiKey }` stores the target.
- Action `crm-inbound-call { number, agentEmail, agentExtension, answered, durationSeconds }`
  performs `GET lookup` then `POST report-call` exactly as the CRM engine
  would, with the bearer header, and records both exchanges.
- Action `crm-outbound-call` does the same with `Outbound`.
- Action `crm-search { q }` performs `GET search`.
- State view `exchanges` lists request and response pairs with status codes.
- Phase 2 surfaces are not built; `wire()` is enough, no `serve()`.

### Non-functional Requirements

- `report-call` finishes within the PBX request timeout: auth, provider
  lookup and enqueue only.
- Every query carries `tenant` in its `WHERE` and `JOIN` conditions.
- The CE build compiles and runs with the EE package aliased away.
- Existing telephony unit and integration tests stay green.

## Data / API / Integrations

- No migrations. The `3cx` provider row uses the existing
  `telephony_providers` columns; the ledger uses `telephony_call_records`.
- Locale keys land in all ten files under `server/public/locales/*/msp/integrations.json`.
- The public v1 API is untouched.

## Security / Permissions

- Card actions and the template download require `canManageTelephony`
  (system settings update). Client-portal users are refused.
- Keys are compared timing-safe. An unknown slug answers 404 before any key
  comparison. Rate limiting reuses `rateLimitConfig.ts`.
- The routes never read the flag. Entitlement is edition and tier.

## Rollout / Migration

- Deploy with the flag off. Nothing changes for any tenant.
- Turn the flag on per tenant in PostHog, targeted on the `tenant` person
  property, which is what the client hook evaluates against.
- The tenant must be on the Pro tier and the deployment must be EE.
- Production check on the demo tenant follows section 4 of the assessment: a
  PRO PBX, a trunk with a number, an extension whose email matches an
  AlgaPSA user, and a contact carrying the caller's mobile number.

## Open Questions

- Whether 3CX runs `ReportCall` once per agent leg on transfers and queue
  calls. Freeze the hash inputs after the trial answers this.
- Whether editing the `ApiKey` parameter in the console restarts the CRM
  engine. Decides the wording next to Rotate.
- Whether `search` should return client-only matches (company, no contact).
  Default: no.

## Acceptance Criteria (Definition of Done)

- Against the emulator, with 3CX enabled on a tenant and a contact seeded
  with a number: `crm-inbound-call` gets a 200 lookup whose `phone` echoes
  the number and whose `contactUrl` points at that contact, then a 202 from
  `report-call`; within one job cycle a `telephony_call_records` row with
  `provider = '3cx'` and a `Call` interaction exist on that contact. Running
  the same action again adds nothing.
- An unknown number gets an empty lookup and lands in the unmatched queue
  after `report-call`.
- Outbound and missed calls journal with `outbound` and `missed`.
- CE answers 501 on every route. A tenant below Pro gets 403. A wrong key
  gets 403. An unknown slug gets 404.
- The card is hidden with the flag off or the tier below Pro, and works with
  both on. Teams Phone's card and actions are unchanged.
- The template validator passes and every URL and header in the rendered
  template matches the route constants.
- `localeQualityGates` and `translationKeyResolution` are green for all ten
  locale files. Existing telephony tests are green.
