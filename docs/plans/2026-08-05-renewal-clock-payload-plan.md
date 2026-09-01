# Repair scheduled workflow clock payloads

## Intent

Make clock-pinned recurring workflows launch with the strict synthetic clock payload the UI promises, including existing renewal-suggestion schedules and newly published time-triggered workflows.

## Code findings

The branch is clean at `860071a686`. Direct inspection confirmed `workflowScheduledRunHandlers.ts` builds clock metadata but launches with `schedule.payload_json ?? {}`; that metadata includes `scheduleName`, which the strict `WorkflowClockTrigger` schema does not allow. `workflowScheduleLifecycle.ts` also writes `{}` for inline schedules, while the 20260713 opportunity seed pins the clock schema without seeding a payload.

## Implementation

1. Add a small typed helper in the scheduled-run handler that derives the exact `WorkflowClockTriggerPayload` fields from schedule/run context and deliberately omits display-only `scheduleName`.
2. Resolve the workflow version's effective payload schema before launch. When it is `WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF`, use the synthetic clock payload; otherwise preserve the stored `payload_json` behavior.
3. Keep the richer trigger metadata (including schedule name) separate for observability; do not relax the strict schema merely to accept metadata.
4. Add a forward migration that repairs the seeded renewal schedule rows for existing tenants in an idempotent, tenant-safe way. Prefer repairing schedule registration/state without inventing stale timestamps; runtime synthesis remains the source of truth for each fire.
5. Align the onboarding seed and inline schedule creation path so new clock schedules do not depend on a user-authored payload.
6. Add behavioral tests for a clock-pinned scheduled launch, a non-clock schedule retaining its payload, strict omission of `scheduleName`, existing renewal-row migration, and newly published time-triggered workflow registration.
7. Run focused workflow/job tests and migration tests, then trigger the renewal schedule against the wired stack and confirm step history begins rather than failing pre-step validation.

## Deliberate non-goals

- Do not weaken `workflowClockTriggerPayloadSchema.strict()`.
- Do not synthesize clock payloads for arbitrary schemas.
- Do not change cron timing or renewal suggestion business logic.

## Risks

Schema resolution must match the exact workflow version being launched. Migration selection must be narrow enough not to rewrite unrelated tenant schedules.
