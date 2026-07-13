# Lane 6: Enterprise opportunity management backend

## Edition boundary

The enterprise implementation lives in `ee/server/src/lib/opportunities/`. Community code owns only two extension points:

- `packages/opportunities/src/lib/closeGates.ts` runs close-won guards without knowing which enterprise modules provide them.
- `packages/ee/src/lib/opportunities/` supplies Community Edition stubs for edition-selected imports.

The server's existing `@enterprise/*` alias selects the real EE module in enterprise builds and the stub in community builds. Management server actions call `assertTierAccess(TIER_FEATURES.OPPORTUNITY_MANAGEMENT)`. API-key routes call `assertTenantTierAccess` after authentication and opportunity permission checks.

The commitments gate is loaded lazily before every close-won attempt. Lazy loading guarantees that server actions, REST calls, and workflow-driven callers all see the same gate even when application startup ordering differs.

## Forecast and calibration

Forecast periods are inclusive date ranges. Open opportunities are included when their expected close date is in the range. Won opportunities are included when `won_at` is in the range.

The base evidence weights are identified 0.05, qualified 0.15, assessment 0.35, proposed 0.50, and verbal 0.80. A seller becomes eligible for calibration after 20 closed opportunities. Eligible sellers use the observed win rate for each reconstructed stage-at-close cohort. A stage with no observations keeps its base rate.

The floor contains full value from open verbal opportunities and opportunities won during the period. The raw ceiling contains won value plus evidence-weighted open value. The returned ceiling is never lower than the floor. Composition rows expose the raw weight and both contributions so consumers can explain this clamp.

Opportunity values are summed as stored because the contract does not include a reporting currency or FX conversion rule. Composition retains each opportunity's currency code.

Calibration reports declared confidence outcomes and new-logo agreement attach rate per seller. Realized billing versus quoted value is omitted because the repository has no stable converted-agreement-to-realized-billing query that can be reused without new accounting attribution infrastructure.

## Meeting sessions and commitments

Meeting sessions are resumable for the same starter on the same UTC calendar day. Reviews are unique per session and opportunity, so marking a deal again updates its review timestamp and note.

Commitments begin open. Resolving one sets the resolution status, optional reference, resolver, and timestamp atomically. Returning a commitment to open clears all resolution fields. Close-won is blocked while any commitment for the opportunity remains open.

## QBR trigger packs

QBR packs reuse the existing renewal, asset-aging, and whitespace computations. Ticket volume compares the most recent 90 days with the preceding 90 days. Trigger keys are stable per source fact.

Reading a pack records each fired trigger in `opportunity_qbr_triggers`. Batch creation accepts only keys in the current pack, writes `generator_context.qbr = true`, and links the fired trigger to the created opportunity. This provides durable fired, created, and won counts for yield reporting.

## Rollups and workflow actions

Seller rollups filter open pipeline by expected close date and closed outcomes by their close timestamp. Users have no assigned office or location column, so rollups group by owner and return null office attribution.

The four workflow actions stay in the shared workflow runtime because FR6 defines their execution as a Community Edition capability. Their handlers use tenant-scoped worker transactions and do not depend on a browser session. Enterprise gating applies to the management actions and management REST endpoints, not to these core workflow operations.

## Verification

Behavioral tests cover forecast floor and ceiling composition with calibration fallback and override, commitment gate blocking and release, QBR pack assembly, and workflow registry execution and validation. Typechecks cover Types, Opportunities, Shared, Server, and the EE server.
