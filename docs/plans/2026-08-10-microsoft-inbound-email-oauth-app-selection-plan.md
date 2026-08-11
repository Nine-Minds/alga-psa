# Microsoft Inbound Email OAuth App Selection — Implementation Map

Canonical artifacts:

- [PRD](2026-08-10-microsoft-inbound-email-oauth-app-selection/PRD.md) defines behavior, invariants, compatibility, rollout, and acceptance criteria.
- [Features](2026-08-10-microsoft-inbound-email-oauth-app-selection/features.json) is the atomic implementation checklist.
- [Tests](2026-08-10-microsoft-inbound-email-oauth-app-selection/tests.json) is the Pareto validation suite.
- [Scratchpad](2026-08-10-microsoft-inbound-email-oauth-app-selection/SCRATCHPAD.md) records architectural decisions, touchpoints, migration reuse, and validation commands.

Implementation sequence:

1. **Selection contract:** add the explicit choice DTO, eligible-profile query, hosted recommendation, guards, and stable errors.
2. **UI:** implement explicit create/reconnect choices, current issuer display, and reconnect warning for client-ID changes.
3. **OAuth state and callback:** sign the complete non-secret selection context, enforce nonce/purpose validation, revalidate eligibility, and atomically persist issuer plus credentials while preserving old connections on failure.
4. **Runtime resolver:** make provider-row issuer metadata authoritative, support same-client secret rotation, and reject different-client changes pending reconnect.
5. **Backfill:** reuse existing fields and conservatively associate only unique eligible same-client matches without touching Teams.
6. **Tests:** execute the PostgreSQL integration, guard, state security, compatibility, migration, runtime, and UI cases in `tests.json`.
