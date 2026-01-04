# PRD — Extension Scheduler Host API

- Slug: `extension-scheduler-host-api`
- Date: `2026-01-02`
- Status: Draft

## Summary

Expose the existing extension scheduled tasks system to extensions via a new `cap:scheduler.manage` capability and corresponding host API. This allows extension authors to programmatically create, update, delete, and list their own scheduled tasks from within extension code, enabling extensions to set up required schedules on install without manual admin configuration.

## Problem

Currently, extension scheduled tasks can only be created via the admin UI or server actions (`extensionScheduleActions.ts`). Extension authors have no way to automatically configure schedules when their extension is installed. This creates friction:

- Admins must manually set up schedules after installing an extension
- Extensions cannot adapt their scheduling to runtime configuration
- No self-service for extension developers who need periodic tasks

Extensions often need predictable periodic execution (sync jobs, cache refresh, reconciliation) and should be able to configure this themselves.

## Goals

- Expose schedule CRUD operations to extensions via a new host API capability
- Allow extensions to manage only their own schedules (scoped to their install)
- Reuse existing validation, quotas, and guardrails from `extensionScheduleActions.ts`
- Follow the established host API pattern (`cap:http.fetch`, `cap:storage.kv`, etc.)
- Enable extension authors to set up schedules during any handler execution (e.g., a `/setup` endpoint)

## Non-goals

- Modifying the underlying schedule execution infrastructure
- Allowing extensions to manage schedules for other extensions
- Changing the admin UI for schedule management
- Adding new schedule features (those belong to the parent scheduled tasks plan)
- Lifecycle hooks (onInstall, onUpdate) — extensions call the API from their own endpoints

## Users and Primary Flows

**Primary persona:** Extension developer building an Alga PSA extension

### Flow: Set up schedules on extension install

1. Extension manifest declares `cap:scheduler.manage` capability
2. Extension exposes a `/setup` or `/init` endpoint
3. After install, admin (or extension UI) calls the `/setup` endpoint
4. Extension handler calls `host.scheduler.list()` to check existing schedules
5. If schedules don't exist, extension calls `host.scheduler.create(...)` for each required schedule
6. Extension returns success; schedules are now active

### Flow: Modify schedule based on user configuration

1. User changes extension config (e.g., sync interval from 1 hour to 6 hours)
2. Extension's config-save handler retrieves the new interval
3. Handler calls `host.scheduler.update(scheduleId, { cron: newCron })`
4. Schedule is updated; next execution uses new timing

### Flow: Clean up schedules on extension disable/uninstall

1. Extension provides a `/cleanup` endpoint (optional)
2. Handler calls `host.scheduler.list()` to get all schedules
3. Handler calls `host.scheduler.delete(id)` for each schedule
4. (Note: system also auto-cleans schedules on uninstall via existing cleanup logic)

## UX / UI Notes

No UI changes required. This is a backend API exposed to extension WASM code.

Extension developers interact via the `HostBindings` interface:

```typescript
export async function handler(request: ExecuteRequest, host: HostBindings) {
  // List existing schedules for this extension install
  const schedules = await host.scheduler.list();

  // Create a new schedule
  const result = await host.scheduler.create({
    endpoint: '/sync',      // path from extension's manifest
    cron: '0 * * * *',      // every hour
    timezone: 'UTC',
    name: 'Hourly Sync',
    payload: { full: false }
  });

  // Update a schedule
  await host.scheduler.update(scheduleId, { enabled: false });

  // Delete a schedule
  await host.scheduler.delete(scheduleId);
}
```

## Requirements

### Functional Requirements

#### Capability registration
- Add `cap:scheduler.manage` to `KNOWN_PROVIDER_CAPABILITIES` in `providers.ts`
- Extensions must declare this capability in their manifest to access scheduler APIs
- Capability is not granted by default (must be explicitly requested and granted)

#### Host API interface (extension-runtime SDK)
- Add `SchedulerHost` interface to `HostBindings` in `sdk/extension-runtime/src/index.ts`
- Define request/response types for each operation

```typescript
interface SchedulerHost {
  list(): Promise<ScheduleInfo[]>;
  get(scheduleId: string): Promise<ScheduleInfo | null>;
  create(input: CreateScheduleInput): Promise<CreateScheduleResult>;
  update(scheduleId: string, input: UpdateScheduleInput): Promise<UpdateScheduleResult>;
  delete(scheduleId: string): Promise<DeleteScheduleResult>;
}

interface ScheduleInfo {
  id: string;
  endpointPath: string;
  endpointMethod: string;
  name?: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  payload?: unknown;
  lastRunAt?: string;
  lastRunStatus?: string;
  lastError?: string;
}

interface CreateScheduleInput {
  endpoint: string;      // path like "/sync" - resolved to endpoint_id
  cron: string;
  timezone?: string;
  enabled?: boolean;
  name?: string;
  payload?: unknown;
}

interface CreateScheduleResult {
  success: boolean;
  scheduleId?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

// UpdateScheduleInput and DeleteScheduleResult similar patterns
```

#### Runner implementation
- Runner receives `cap:scheduler.manage` in `providers` array
- Runner implements host bindings that call back to the Alga server
- Server exposes internal API endpoints for Runner to call (or Runner proxies to existing actions)

#### Server-side handler
- Create internal API routes or RPC handler for scheduler operations
- Route handler validates the calling extension/install context
- Delegate to existing `extensionScheduleActions` functions (reuse validation, quotas, job runner integration)
- Scope all operations to the calling extension's `install_id`

#### Endpoint resolution
- Extensions reference endpoints by path (e.g., `/sync`) not by UUID
- Server resolves path to `endpoint_id` using the installed version's endpoint table
- Reject paths that don't exist in the extension's manifest

### Non-functional Requirements

#### Security
- Extensions can only manage schedules for their own install (enforced by server)
- Existing quotas apply: max 50 schedules per install, min 5-min interval
- Rate limiting on create/update operations (prevent abuse)
- No cross-tenant or cross-extension access

#### Reliability
- Reuse existing transactional guarantees from `extensionScheduleActions`
- Errors are returned as structured results, not thrown exceptions (WASM boundary)

#### Observability
- Log scheduler host API calls with extension/install context
- Include in extension execution metrics

## Data / API / Integrations

### New capability
```typescript
// ee/server/src/lib/extensions/providers.ts
export const KNOWN_PROVIDER_CAPABILITIES = [
  // ... existing
  'cap:scheduler.manage',
] as const;
```

### SDK interface addition
```typescript
// sdk/extension-runtime/src/index.ts
export interface SchedulerHost {
  list(): Promise<ScheduleInfo[]>;
  get(scheduleId: string): Promise<ScheduleInfo | null>;
  create(input: CreateScheduleInput): Promise<CreateScheduleResult>;
  update(scheduleId: string, input: UpdateScheduleInput): Promise<UpdateScheduleResult>;
  delete(scheduleId: string): Promise<DeleteScheduleResult>;
}

export interface HostBindings {
  // ... existing bindings
  scheduler: SchedulerHost;
}
```

### Runner-to-server communication
- Option A: Runner calls back to Alga server via HTTP (internal API)
- Option B: Runner proxies through existing execution response mechanism
- Decision: TBD based on Runner architecture exploration

### Internal API (if using HTTP callback)
```
POST /api/internal/extensions/scheduler/list
POST /api/internal/extensions/scheduler/get
POST /api/internal/extensions/scheduler/create
POST /api/internal/extensions/scheduler/update
POST /api/internal/extensions/scheduler/delete
```

All endpoints receive install context (tenant_id, install_id) from Runner authentication.

## Security / Permissions

- Extensions must declare `cap:scheduler.manage` in manifest
- Tenant admin must grant the capability during install (normal capability grant flow)
- All operations are scoped to the calling extension's install_id
- Existing validation applies (cron format, timezone, endpoint existence, quotas)
- No elevation of privilege: extensions cannot bypass quotas or create schedules for other extensions

## Observability

- Log each host API call: operation, install_id, success/failure, duration
- Include `trigger=host_api` in schedule creation metadata (vs `trigger=admin_ui`)
- Expose metrics: `extension_scheduler_api_calls_total{operation, status}`

## Rollout / Migration

1. Add capability to `KNOWN_PROVIDER_CAPABILITIES`
2. Add `SchedulerHost` interface to SDK
3. Implement Runner host bindings
4. Add server-side handler (reusing `extensionScheduleActions`)
5. Update SDK documentation with usage examples
6. No migration needed: this is additive functionality

## Open Questions

1. **Runner callback mechanism**: How does the Runner currently call back to the host for other capabilities (http.fetch, storage.kv)? We should use the same pattern.
2. **Endpoint reference format**: Should extensions reference endpoints by path only, or by `method + path`? (Recommendation: path only, since schedules are limited to GET/POST anyway)
3. **Error format**: Should we expose field-level errors to extensions, or simplify to just `error: string`?

## Acceptance Criteria (Definition of Done)

- [ ] `cap:scheduler.manage` is a recognized capability in the system
- [ ] Extensions with the capability can call `host.scheduler.list()` and receive their schedules
- [ ] Extensions can create schedules by endpoint path; server resolves to endpoint_id
- [ ] Extensions can update and delete their own schedules
- [ ] Existing quotas and validation are enforced
- [ ] Extensions cannot access schedules from other extensions or tenants
- [ ] SDK types are published and documented
- [ ] At least one sample extension demonstrates schedule self-configuration
