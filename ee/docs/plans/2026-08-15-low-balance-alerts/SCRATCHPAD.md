# Scratchpad — Low-Balance Alerts for Prepaid Credit and Bucket Hours

- Plan slug: `2026-08-15-low-balance-alerts`
- Card: `29.8.20`
- Created: `2026-08-15`
- Status: Design complete; implementation not started

## Decisions

- (2026-08-15) Reuse the existing 09:00 UTC maintenance architecture: CE schedules the tenant job, while EE uses one global schedule and the existing per-tenant maintenance fanout with overlap `SKIP`.
- (2026-08-15) Configure policies per client: one amount/currency credit floor and one bucket-consumption percentage applying to every active bucket owned by that client.
- (2026-08-15) Account-manager routing is mandatory when an active manager can be resolved; client billing-recipient email is separately opt-in and defaults off.
- (2026-08-15) A credit alert is one below-threshold episode, rearmed only after recovery to equality or above. A bucket alert is one `bucket_usage` period/configured-percent pair.
- (2026-08-15) Persist logical alerts separately from delivery attempts. Internal delivery is transactionally idempotent; email uses a stable leased delivery row and bounded retries with documented at-least-once semantics.
- (2026-08-15) `release-v1.5-feature` gates the whole feature independently at UI, settings action, and scan-subscriber boundaries; unavailable flag infrastructure fails closed.

## Discoveries / Constraints

- (2026-08-15) `BillingConfiguration.tsx` already renders `ClientCreditExpirationSettings` before `ClientExternalCreditSettings`; the new card belongs exactly between them in the General tab.
- (2026-08-15) Server flag checks already fail closed when no checker is registered through `isFeatureFlagEnabled`; the client hook exposes both `loading` and `enabled` and accepts `defaultValue: false`.
- (2026-08-15) The existing EE maintenance fanout is `packages/jobs/src/lib/maintenanceJobFanout.ts`; it maps tenant-scoped job names to the same handlers used by CE and isolates failures per tenant.
- (2026-08-15) The grounded PRD initially named a nonexistent `packages/jobs/src/lib/jobs/registerAllHandlers.ts`. The real central registry is `server/src/lib/jobs/registerAllHandlers.ts`; the PRD and handoff were corrected.
- (2026-08-15) Client settings translations live in ten files: `server/public/locales/{de,en,es,fr,it,nl,pl,pt,xx,yy}/msp/clients.json`; both pseudo-locales are part of completeness.
- (2026-08-15) Canonical invoice-recipient precedence is billing contact, client billing email, active billing-location email, active default-location email, then none. Reuse it rather than duplicating contact queries.
- (2026-08-15) Credit equality is recovery (`available >= threshold`); bucket equality is alerting (`consumed * 100 >= threshold * capacity`). Keep these asymmetric boundaries explicit in code and tests.
- (2026-08-15) No new client-portal in-app notification, immediate/event-driven evaluation, FX conversion, tenant defaults, per-bucket overrides, or exactly-once email guarantee belongs in this card.

## Commands / Runbooks

- Validate the ALGA plan: `python3 /home/robert/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-08-15-low-balance-alerts`
- Independently parse both checklists: `python3 -m json.tool ee/docs/plans/2026-08-15-low-balance-alerts/features.json >/dev/null` and the same command for `tests.json`.
- During implementation, run the migration/integration harness against a migrated tenant database; source-string checks do not satisfy T004–T007, T009–T017, or T021–T023.
- Before committing design, stage only `ee/docs/plans/2026-08-15-low-balance-alerts/` and `docs/plans/2026-08-15-low-balance-alerts-plan.md`; leave the pre-existing `package-lock.json` modification unstaged.

## Links / References

- Product scope: `ee/docs/plans/2026-08-15-low-balance-alerts/PRD.md`
- Implementation checklist: `ee/docs/plans/2026-08-15-low-balance-alerts/features.json`
- Test checklist: `ee/docs/plans/2026-08-15-low-balance-alerts/tests.json`
- Ordered implementation handoff: `docs/plans/2026-08-15-low-balance-alerts-plan.md`
- Card: `29.8.20`

## Open Questions

- None. Repository-path correction is resolved and all product decisions needed for implementation are settled.
