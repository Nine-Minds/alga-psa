# Extension Scheduling + Temporal Execution Test Plan (Hosted EE)

This document defines a concrete, implementation-oriented test plan to validate extension scheduling and Temporal execution paths in hosted Enterprise Edition. It focuses on ensuring that schedules created via UI/host APIs are registered in Temporal and executed by the worker, and that failures surface safely.

## Goals

- Validate that extension schedules are registered in Temporal and executed via `genericJobWorkflow`.
- Validate the end-to-end flow from UI/API schedule creation to Temporal execution and runner invocation.
- Validate task-queue routing and worker handler registration for `extension-scheduled-invocation`.
- Validate run-now execution uses Temporal workflow path and updates job/schedule records.
- Validate Temporal worker startup configuration for hosted EE.

## Non-goals

- Coverage for non-extension scheduling (billing schedules, ticket scheduling, etc.).
- Performance/load testing or latency benchmarking.
- Full validation of runner implementation or extension code behavior beyond schedule invocation.
- Testing the legacy pg-boss scheduling path (CE).

## Current Coverage Summary

Existing tests cover DB-level scheduling logic, validation, and handler behavior, but do not validate real Temporal execution.

Key current tests:

- `ee/server/src/__tests__/integration/extension-schedules.actions.integration.test.ts`
  - DB integration for admin-facing schedule CRUD, validation, atomicity, enable/disable, run-now enqueue.
  - Mocks job runner (no Temporal).
- `ee/server/src/__tests__/integration/schedulerHostApi.integration.test.ts`
  - DB integration for scheduler host API (runner-facing, by endpoint path).
  - Mocks job runner (no Temporal).
- `ee/server/src/__tests__/integration/extension-schedule-cleanup.integration.test.ts`
  - Uninstall/toggle cleanup for schedules and runner cancellation. Mocks job runner.
- `ee/server/src/__tests__/integration/extension-schedule-remap.integration.test.ts`
  - Remap schedule endpoints across extension version update. Mocks job runner.
- `ee/server/src/__tests__/integration/extension-scheduled-invocation.handler.integration.test.ts`
  - Invokes `extensionScheduledInvocationHandler` directly. Uses DB + fetch mock; no Temporal.
- `ee/server/src/__tests__/unit/temporalJobRunner.*.test.ts`
  - Unit tests for `TemporalJobRunner` using mocked `@temporalio/client`.
- `ee/server/src/__tests__/integration/extension-schedules.playwright.test.ts`
  - UI schedule create/edit/toggle/run-now; verifies DB only.

Temporal workflow tests exist but do not cover generic job workflow:

- `ee/temporal-workflows/src/workflows/portal-domains/__tests__/registration.workflow.integration.test.ts`
- `ee/temporal-workflows/src/activities/__tests__/tenant-activities.test.ts`
- `ee/temporal-workflows/src/activities/__tests__/email-activities.temporal.test.ts`

Gaps:

- No test verifies that schedules created in UI/API are registered in Temporal.
- No test validates `genericJobWorkflow` execution, status updates, or activity wiring.
- No test validates `initializeJobHandlersForWorker` registration for extension scheduled jobs.
- No test validates real Temporal schedule execution path for extension schedules.
- No test validates worker startup configuration checks in `ee/temporal-workflows/src/config/startupValidation.ts`.

## Key Risks (Production)

- Temporal schedules not created or misconfigured despite green tests.
- `genericJobWorkflow` fails to execute or update job status, and tests don’t catch it.
- Worker task queue misconfiguration (missing `alga-jobs`) leads to no executions.
- Worker fails startup validation in hosted environments due to missing required secrets.
- Handler registration for `extension-scheduled-invocation` fails, leaving jobs queued forever.

## Test Pyramid

Unit (fast, deterministic):

- Validate parsing, validation, error handling in isolation.
- Mock DB and Temporal SDK.

Integration (real DB + Temporal):

- Validate Temporal schedule creation, execution, and job status updates end-to-end.
- Use `@temporalio/testing` (time-skipping) or docker Temporal (full integration).

E2E (UI + Temporal + DB):

- Validate UI flows create Temporal schedules and that those schedules execute.

## Proposed New Tests (Exact Suggestions)

### Unit

1) `ee/temporal-workflows/src/workflows/__tests__/generic-job-workflow.temporal.test.ts`

- Use `TestWorkflowEnvironment.createTimeSkipping()`.
- Start `genericJobWorkflow` with stubbed activities for:
  - `executeJobHandler` success and failure
  - `updateJobStatus` called with expected status
- Assert workflow state transitions and final result structure.

2) `ee/temporal-workflows/src/config/__tests__/startupValidation.test.ts`

- Validate missing required envs cause failure.
- Validate optional defaults are applied.
- Validate `EMAIL_PROVIDER=resend` requires `RESEND_API_KEY`.
- Mock secrets provider via `@alga-psa/core/secrets` import.

3) `ee/server/src/__tests__/unit/temporalJobRunner.parseScheduleSpec.test.ts`

- Validate cron vs interval parsing and timezone propagation.
- Include cron with 5 fields and duration strings.

### Integration (Temporal + DB)

4) `ee/server/src/__tests__/integration/extension-schedules.temporal.integration.test.ts`

Goal: verify schedule creation registers a Temporal schedule and executes handler.

Suggested flow:

- Setup real DB using `createTestDbConnection` and apply EE migrations.
- Use Temporal test env or docker Temporal.
- Create schedule via `createExtensionSchedule` or `schedulerHostApi.createSchedule`.
- Verify Temporal schedule exists: `client.schedule.getHandle(id).describe()`.
- Advance time or trigger schedule; verify:
  - `genericJobWorkflow` executed via Temporal.
  - `extensionScheduledInvocationHandler` updates `tenant_extension_schedule.last_run_*`.

5) `ee/server/src/__tests__/integration/extension-run-now.temporal.integration.test.ts`

- Create schedule (enabled or disabled), call `runExtensionScheduleNow`.
- Verify Temporal workflow started on `alga-jobs` and completed.
- Verify `jobs` table updated to completed/failed and schedule last-run fields updated.

6) `ee/temporal-workflows/src/__tests__/worker-extension-handler.integration.test.ts`

- Start a Worker using the real `activities` set, ensure `initializeJobHandlersForWorker` executes.
- Start `genericJobWorkflow` on `alga-jobs` and assert the `executeJobHandler` activity is invoked.
- Mock runner HTTP using fetch, reuse `extensionScheduledInvocationHandler` tests as guidance.

### E2E (UI + Temporal)

7) Extend `ee/server/src/__tests__/integration/extension-schedules.playwright.test.ts`

- After UI schedule create, verify Temporal schedule exists and fires (use Temporal client from test).
- For hosted CI: run against docker Temporal in compose.

## Required Mocks vs Real Dependencies

Unit tests:

- Mock `@temporalio/client` and DB access.
- Mock secrets provider.

Integration tests:

- Real Postgres (test DB) + Temporal (test env or docker).
- Mock only runner HTTP (`globalThis.fetch`) to avoid depending on actual runner service.
- Do not mock Temporal client/worker.

E2E tests:

- Real Postgres + Temporal.
- Runner HTTP can be stubbed or use a lightweight fake service.

## CI Execution Strategy

Split into tiers to keep CI stable and fast:

1) Unit tier (fast):

```
cd ee/server && npm run test:unit
cd ee/temporal-workflows && npm run test:unit
```

2) Integration tier (Temporal + DB):

- Use docker Temporal from `ee/temporal-workflows/docker-compose.test.yml`.
- Run new Temporal integration tests with a dedicated Vitest config (single fork).

Example:

```
cd ee/temporal-workflows && npm run docker:test:up
cd ee/server && npm run test:integration -- --runInBand --testNamePattern=Temporal
cd ee/temporal-workflows && npm run test -- src/__tests__/worker-extension-handler.integration.test.ts
cd ee/temporal-workflows && npm run docker:test:down
```

3) E2E tier (Playwright + Temporal):

```
cd ee/server && npm run test:playwright
```

## Local/Manual Validation Steps

Temporal + UI:

```
docker-compose -f docker-compose.temporal.ee.yaml up -d
cd ee/temporal-workflows && npm run dev
cd ee/server && npm run dev
```

- Create an extension schedule in UI.
- Use Temporal UI (`http://localhost:8233`) to verify schedule exists.
- Wait for execution and verify `tenant_extension_schedule.last_run_*` fields update.

Direct run-now:

- Trigger run-now in UI and verify Temporal workflow execution in Temporal UI.
- Verify `jobs` and schedule records update.

## Rollout Phases

Quick wins (1–3 days):

- Add `genericJobWorkflow` Temporal test.
- Add `startupValidation` unit tests.
- Add `parseScheduleSpec` unit tests.

Must-have before release:

- Add Temporal integration tests for schedule registration and execution.
- Add run-now Temporal integration test.
- Add worker handler registration integration test.

Hardening:

- Extend Playwright schedule test to assert Temporal schedule exists and fires.
- Add Temporal failure-mode tests (connection failure, schedule update error handling).

## Exit Criteria

- Unit tests:
  - `genericJobWorkflow` verified for success and failure paths.
  - `startupValidation` required/optional config behaviors validated.
  - `parseScheduleSpec` covers cron/interval and edge cases.

- Integration tests:
  - Creating a schedule via API results in a real Temporal schedule and at least one execution.
  - Run-now triggers a Temporal workflow execution and updates DB job/schedule state.
  - Worker registers `extension-scheduled-invocation` handler and executes `genericJobWorkflow` successfully.

- E2E:
  - UI schedule creation results in a Temporal schedule and recorded execution.

- CI stability:
  - Temporal integration tests run reliably in CI with docker Temporal.
  - New tests are under 10 minutes aggregate runtime in CI.

