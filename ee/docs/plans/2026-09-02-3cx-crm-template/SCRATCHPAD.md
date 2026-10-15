# Scratchpad — 3CX CRM Template Integration

- Plan slug: `2026-09-02-3cx-crm-template`
- Created: `2026-09-02`

## Decisions

- (2026-09-02) Enterprise Edition only. 3CX inherits the edition refusal in
  `resolveTelephonyAvailability` and the 501 stub in `_ceStub.ts`. The EE
  code lives in `ee/packages/threecx`, aliased to `packages/ee/src` on CE.
- (2026-09-02) The flag `release-v1-6-feature` gates only the settings card.
  Routes, server actions and the job handler never read it. Entitlement on
  the server is edition, then tier, then an active provider row.
- (2026-09-02) Pro tier through a new `TIER_FEATURES.PBX_TELEPHONY`. Nothing
  new gates at `solo`.
- (2026-09-02) Bearer header from the template's `Headers` element instead
  of Basic auth, because `authVerifier.ts` has `hmac_sha256`, `bearer`,
  `ip_allowlist` and `path_token` and no Basic mode.
- (2026-09-02) `report-call` enqueues a job and answers 202. The Teams route
  does the same at `server/src/app/api/telephony/webhooks/teams-calls/route.ts:133`;
  ingestion, auto-ticket and notification run in the handler.
- (2026-09-02) The agent is resolved by email, not extension. `users.phone_extension`
  is the extension part of the user's own phone number (migration
  `20260818120000`), not a PBX DN map, and nothing in telephony reads it.
- (2026-09-02) `Missed` and `Notanswered` map to direction `missed`.
  `CALL_DIRECTIONS` already has it.
- (2026-09-02) Emulator on port 4070. Xero took 4060 on 2026-08-30.

## Discoveries / Constraints

- (2026-09-02) The Teams add-on is gone (`ca245b90a1`, 2026-08-27) and so is
  the 1.5 flag with `telephonyFeatureGate.ts` (`dba55c91ab`, 2026-08-31).
  Telephony is edition-only today. `TelephonyAvailabilityDisabledReason`
  still declares `feature_disabled` with nothing producing it.
- (2026-09-02) `TIER_FEATURES.TEAMS_INTEGRATION` still sits in
  `ADD_ON_ONLY_FEATURES`, so `tierHasFeature` is false for it on every tier.
  Clean it up in the `flag-and-tier` group.
- (2026-09-02) Server-side tier checks: `assertTenantTierAccess` lives in
  `server/src/lib/tier-gating/assertTierAccess.ts`, which packages cannot
  import. The helper in `packages/integrations` uses `resolveTenantTier`
  from `@alga-psa/licensing` plus `tierHasFeature` from `@alga-psa/types`.
  Build the licensing dist before running tests that touch it.
- (2026-09-02) Client flag evaluation uses the `tenant` person property;
  server evaluation sends a `tenant` group. Only the card reads the flag, so
  target PostHog on the person property. The friction is marked at
  `packages/ui/src/components/analytics/PostHogUserIdentifier.tsx:91`.
- (2026-09-02) `NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=true` is set only by the
  Playwright config. Vitest registers no checker. Card tests pin the flag
  with `NEXT_PUBLIC_FORCE_FEATURE_FLAGS` or by mocking `useFeatureFlag`.
- (2026-09-02) `contacts/search` in the public v1 API does substring-match
  `normalized_phone_number`, but it is bound to a per-user API key and
  cannot echo the searched number, which 3CX needs to accept a match.
- (2026-09-02) `resolvePendingCallIntent` matches intents on
  `provider_user_id`, and the intent recorder in `telephonyActions.ts:207`
  hard-codes `teams-phone`. Outbound intents for 3CX are Phase 2 work.
- (2026-09-02) The Teams EE module is loaded as
  `import('@alga-psa/ee-microsoft-teams/lib')` from
  `packages/integrations/src/actions/integrations/telephonyActions.ts:343`.
  The registry generalizes that per provider.
- (2026-09-02) `ws` exists only as a root `overrides` floor; no emulator
  declares it. Phase 1 does not need it.
- (2026-09-02) 3CX docs, fetched 2026-09-02: Call Control needs an 8SC+
  Enterprise license; PRO includes CRM integration; SMB has no CRM
  integration. The XML reference confirms the reserved scenario ids,
  `ContactUrl` as mandatory, last-N-digit matching via `MaxLength`, the
  `Plus` prefix mode and the per-request `Headers` element. No `CallId`
  variable exists.

## Commands / Runbooks

- Validate the plan files:
  `python3 ~/.claude/skills/software-planner/scripts/validate_plan.py ee/docs/plans/2026-09-02-3cx-crm-template`
- Telephony unit tests: `cd server && npx vitest run packages/telephony`
  after `npm --prefix packages/licensing run build`.
- Emulator suite locally: see `packages/emulators/README.md`; add
  `threecx` to the port table and `compose.yml` before the first run.
- Fetch a 3CX doc for grepping (WebFetch truncates them):
  `curl -sL -A "Mozilla/5.0" https://www.3cx.com/docs/crm-template-xml-description/ -o page.html`

## Links / References

- Decision record: `ee/docs/plans/2026-08-28-3cx-integration-assessment/ASSESSMENT.md`
- Parent class PRD: `ee/docs/plans/2026-08-22-telephony-integration/PRD.md`
  (its Gating section predates `ca245b90a1` and is superseded)
- Teams webhook route: `server/src/app/api/telephony/webhooks/teams-calls/route.ts`
- Teams EE telephony module: `ee/packages/microsoft-teams/src/lib/telephony/`
- Availability helpers: `packages/integrations/src/lib/telephonyAvailability.ts`,
  `telephonyAvailabilityCore.ts`
- Tier registry: `packages/types/src/constants/tierFeatures.ts`
- Inbound-webhook helpers: `server/src/lib/inboundWebhooks/{tenantResolver,authVerifier,rateLimitConfig}.ts`
- Job registration: `server/src/lib/jobs/registerAllHandlers.ts:650`
- RMM registry pattern: `packages/integrations/src/lib/rmm/providerRegistry.ts`
- Emulator skeleton: `packages/emulators/stripe/src/`
- 3CX CRM template XML reference: https://www.3cx.com/docs/crm-template-xml-description/

## Open Questions

- Does 3CX run `ReportCall` once per agent leg on transfers and queue calls?
  Answer on the PRO trial before freezing the hash inputs.
- Does editing the `ApiKey` template parameter in the console restart the
  CRM engine? Decides the wording next to Rotate.
- Should `search` return client-only matches? Default is no.
