import type { ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';

// Inline jsonResponse to avoid external dependency for jco componentize
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function jsonResponse(body: unknown, init: Partial<ExecuteResponse> = {}): ExecuteResponse {
  const encoded = body instanceof Uint8Array ? body : encoder.encode(JSON.stringify(body));
  return {
    status: init.status ?? 200,
    headers: init.headers ?? [{ name: 'content-type', value: 'application/json' }],
    body: encoded,
  };
}

const BUILD_STAMP = '2026-01-02T00:00:00Z';

type SchedulerEndpoint = {
  id?: string;
  method?: string;
  path?: string;
  handler?: string;
  schedulable?: boolean;
};

/**
 * Scheduler Demo Extension
 *
 * This extension demonstrates how to use the cap:scheduler.manage capability
 * to programmatically create, update, and delete scheduled tasks.
 *
 * Endpoints:
 * - GET /api/status - Health check endpoint (schedulable)
 * - POST /api/setup - Auto-configure schedules on first run
 * - GET /api/schedules - List all schedules for this extension
 * - DELETE /api/schedules/:id - Delete a specific schedule
 * - POST /api/heartbeat - Scheduled heartbeat endpoint (schedulable)
 */

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  try {
    return await processRequest(request, host);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[scheduler-demo] unhandled error build=${BUILD_STAMP} reason=${reason}`);
    return jsonResponse(
      {
        error: 'handler_failed',
        message: 'Scheduler demo handler encountered an unexpected error.',
        detail: reason,
        build: BUILD_STAMP,
      },
      { status: 500 }
    );
  }
}

async function processRequest(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const rawMethod = request.http.method || 'GET';
  const rawUrl = request.http.url || '/';
  const url = normalizePath(rawUrl);
  const method = resolveEffectiveMethod(rawMethod, rawUrl, request.http.body);
  const requestId = request.context.requestId ?? 'n/a';
  const tenantId = request.context.tenantId;

  await safeLog(
    host,
    'info',
    `[scheduler-demo] request start tenant=${tenantId} requestId=${requestId} method=${method} url=${url} build=${BUILD_STAMP}`
  );

  // Route based on method and path
  if (method === 'GET' && url.startsWith('/api/status')) {
    return handleStatus(request, host);
  }

  if (method === 'POST' && url.startsWith('/api/setup')) {
    return handleSetup(request, host);
  }

  if (method === 'GET' && url.startsWith('/api/schedules')) {
    return handleListSchedules(request, host);
  }

  if (method === 'DELETE' && url.startsWith('/api/schedules/')) {
    const scheduleId = url.replace('/api/schedules/', '').split('?')[0];
    return handleDeleteSchedule(request, host, scheduleId);
  }

  if (method === 'POST' && url.startsWith('/api/heartbeat')) {
    return handleHeartbeat(request, host);
  }

  return jsonResponse(
    { error: 'not_found', message: `No handler for ${method} ${url}` },
    { status: 404 }
  );
}

function normalizePath(url: string): string {
  const idx = url.indexOf('?');
  return idx >= 0 ? url.slice(0, idx) : url;
}

function resolveEffectiveMethod(method: string, rawUrl: string, requestBody?: Uint8Array | null): string {
  if (method !== 'POST') return method;
  const override = extractOverrideFromQuery(rawUrl) || extractOverrideFromBody(requestBody);
  if (override === 'GET' || override === 'POST' || override === 'DELETE') {
    return override;
  }
  return method;
}

function extractOverrideFromQuery(rawUrl: string): string {
  const idx = rawUrl.indexOf('?');
  if (idx < 0) return '';
  const query = rawUrl.slice(idx + 1);
  const params = new URLSearchParams(query);
  return (params.get('__method') || '').toUpperCase();
}

function extractOverrideFromBody(requestBody?: Uint8Array | null): string {
  if (!requestBody || requestBody.length === 0) return '';
  try {
    const parsed = JSON.parse(decoder.decode(requestBody)) as { __method?: string };
    return (parsed?.__method || '').toUpperCase();
  } catch {
    return '';
  }
}

/**
 * GET /api/status - Simple status endpoint that can be scheduled
 */
async function handleStatus(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', `[scheduler-demo] status check at ${new Date().toISOString()}`);

  return jsonResponse({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    tenant: request.context.tenantId,
    extension: request.context.extensionId,
    build: BUILD_STAMP,
  });
}

/**
 * POST /api/heartbeat - Endpoint designed to be called on a schedule
 */
async function handleHeartbeat(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const now = new Date().toISOString();
  await safeLog(host, 'info', `[scheduler-demo] heartbeat at ${now}`);

  return jsonResponse({
    event: 'heartbeat',
    timestamp: now,
    tenant: request.context.tenantId,
    message: 'Scheduled heartbeat executed successfully',
    build: BUILD_STAMP,
  });
}

/**
 * POST /api/setup - Auto-configure schedules for this extension
 *
 * This demonstrates how an extension can set up its own scheduled tasks
 * when first installed or when explicitly triggered.
 */
async function handleSetup(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  await safeLog(host, 'info', '[scheduler-demo] starting schedule setup...');

  // Older versions of @alga-psa/extension-runtime shipped without scheduler typings.
  // This demo targets the scheduler capability, so we access it dynamically.
  const scheduler = (host as any).scheduler as any;
  let discoveredEndpoints: SchedulerEndpoint[] = [];

  const results: Array<{ name: string; success: boolean; scheduleId?: string; error?: string }> = [];

  // First, discover available schedulable endpoints
  try {
    const endpoints = (await scheduler.getEndpoints()) as SchedulerEndpoint[];
    discoveredEndpoints = endpoints;
    await safeLog(host, 'info', `[scheduler-demo] discovered ${endpoints.length} endpoints`);

    const schedulableEndpoints = endpoints.filter((e: { schedulable?: boolean }) => e.schedulable);
    await safeLog(host, 'info', `[scheduler-demo] ${schedulableEndpoints.length} schedulable endpoints`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[scheduler-demo] failed to get endpoints: ${reason}`);
  }

  // Scheduler host API resolves endpoints by path (method is implicit in endpoint metadata).
  // Prefer discovered endpoints to avoid drift between manifest and handler route strings.
  const resolveEndpointPath = (method: 'GET' | 'POST', fallbackPath: string): string => {
    const desired = normalizeEndpointPath(fallbackPath);
    const match = discoveredEndpoints.find((e) => {
      if (!e || e.schedulable === false) return false;
      const endpointMethod = String(e.method || '').toUpperCase();
      const endpointPath = normalizeEndpointPath(e.path || '');
      return endpointMethod === method && endpointPath === desired;
    });
    return normalizeEndpointPath(match?.path || desired);
  };

  // Check existing schedules to avoid duplicates
  let existingSchedules: Array<{ name?: string | null; endpointPath: string }> = [];
  try {
    existingSchedules = await scheduler.list();
    await safeLog(host, 'info', `[scheduler-demo] found ${existingSchedules.length} existing schedules`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'warn', `[scheduler-demo] failed to list existing schedules: ${reason}`);
  }

  // Create a heartbeat schedule (every 5 minutes) if it doesn't exist
  const heartbeatExists = existingSchedules.some(
    s => s.name === 'Heartbeat Check' || s.endpointPath === '/api/heartbeat'
  );

  if (!heartbeatExists) {
    try {
      const result = await scheduler.create({
        endpoint: resolveEndpointPath('POST', '/api/heartbeat'),
        cron: '*/5 * * * *', // Every 5 minutes
        timezone: 'UTC',
        enabled: true,
        name: 'Heartbeat Check',
        payload: JSON.stringify({ source: 'auto-setup' }),
      });

      if (result.success) {
        await safeLog(host, 'info', `[scheduler-demo] created heartbeat schedule: ${result.scheduleId}`);
        results.push({ name: 'Heartbeat Check', success: true, scheduleId: result.scheduleId ?? undefined });
      } else {
        await safeLog(host, 'warn', `[scheduler-demo] failed to create heartbeat schedule: ${result.error}`);
        results.push({ name: 'Heartbeat Check', success: false, error: result.error ?? 'Unknown error' });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await safeLog(host, 'error', `[scheduler-demo] heartbeat schedule creation error: ${reason}`);
      results.push({ name: 'Heartbeat Check', success: false, error: reason });
    }
  } else {
    await safeLog(host, 'info', '[scheduler-demo] heartbeat schedule already exists, skipping');
    results.push({ name: 'Heartbeat Check', success: true, error: 'Already exists (skipped)' });
  }

  // Create a daily status check if it doesn't exist
  const statusExists = existingSchedules.some(
    s => s.name === 'Daily Status Check' || s.endpointPath === '/api/status'
  );

  if (!statusExists) {
    try {
      const result = await scheduler.create({
        endpoint: resolveEndpointPath('GET', '/api/status'),
        cron: '0 9 * * *', // Every day at 9 AM
        timezone: 'America/New_York',
        enabled: true,
        name: 'Daily Status Check',
      });

      if (result.success) {
        await safeLog(host, 'info', `[scheduler-demo] created status schedule: ${result.scheduleId}`);
        results.push({ name: 'Daily Status Check', success: true, scheduleId: result.scheduleId ?? undefined });
      } else {
        await safeLog(host, 'warn', `[scheduler-demo] failed to create status schedule: ${result.error}`);
        results.push({ name: 'Daily Status Check', success: false, error: result.error ?? 'Unknown error' });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await safeLog(host, 'error', `[scheduler-demo] status schedule creation error: ${reason}`);
      results.push({ name: 'Daily Status Check', success: false, error: reason });
    }
  } else {
    await safeLog(host, 'info', '[scheduler-demo] status schedule already exists, skipping');
    results.push({ name: 'Daily Status Check', success: true, error: 'Already exists (skipped)' });
  }

  const allSuccess = results.every(r => r.success);

  return jsonResponse({
    message: allSuccess ? 'Setup completed successfully' : 'Setup completed with some errors',
    results,
    build: BUILD_STAMP,
  }, { status: allSuccess ? 200 : 207 });
}

function normalizeEndpointPath(path: string): string {
  const raw = String(path || '').trim();
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/**
 * GET /api/schedules - List all schedules for this extension
 */
async function handleListSchedules(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  try {
    const schedules = await (host as any).scheduler.list();
    await safeLog(host, 'info', `[scheduler-demo] listed ${schedules.length} schedules`);

    return jsonResponse({
      count: schedules.length,
      schedules,
      build: BUILD_STAMP,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[scheduler-demo] failed to list schedules: ${reason}`);

    return jsonResponse(
      {
        error: 'list_failed',
        message: 'Failed to list schedules',
        detail: reason,
        build: BUILD_STAMP,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/schedules/:id - Delete a specific schedule
 */
async function handleDeleteSchedule(
  request: ExecuteRequest,
  host: HostBindings,
  scheduleId: string
): Promise<ExecuteResponse> {
  if (!scheduleId) {
    return jsonResponse(
      { error: 'invalid_request', message: 'Schedule ID is required' },
      { status: 400 }
    );
  }

  try {
    const result = await (host as any).scheduler.delete(scheduleId);

    if (result.success) {
      await safeLog(host, 'info', `[scheduler-demo] deleted schedule ${scheduleId}`);
      return jsonResponse({
        message: 'Schedule deleted successfully',
        scheduleId,
        build: BUILD_STAMP,
      });
    } else {
      await safeLog(host, 'warn', `[scheduler-demo] failed to delete schedule ${scheduleId}: ${result.error}`);
      return jsonResponse(
        {
          error: 'delete_failed',
          message: result.error ?? 'Failed to delete schedule',
          scheduleId,
          build: BUILD_STAMP,
        },
        { status: 400 }
      );
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[scheduler-demo] delete error for ${scheduleId}: ${reason}`);

    return jsonResponse(
      {
        error: 'delete_error',
        message: 'Error deleting schedule',
        detail: reason,
        scheduleId,
        build: BUILD_STAMP,
      },
      { status: 500 }
    );
  }
}

async function safeLog(host: HostBindings, level: 'info' | 'warn' | 'error', message: string) {
  try {
    await host.logging[level](message);
  } catch {
    // Swallow logging errors to avoid cascading failures.
  }
}
