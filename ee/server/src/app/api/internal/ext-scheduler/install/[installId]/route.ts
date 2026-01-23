import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getEndpoints,
  InstallContext,
} from '@ee/lib/extensions/schedulerHostApi';
import { getInstallConfigByInstallId } from '@ee/lib/extensions/installConfig';

export const dynamic = 'force-dynamic';

type RouteParams = { installId: string };

async function resolveParams(params: RouteParams | Promise<RouteParams>): Promise<RouteParams> {
  return await Promise.resolve(params);
}

// Simple in-memory rate limiter for create/update operations
// Limits: 10 operations per minute per install
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_OPERATIONS = 10;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60_000);

function checkRateLimit(installId: string, operation: string): boolean {
  // Only rate limit mutating operations
  if (!['create', 'update', 'delete'].includes(operation)) {
    return true;
  }

  const key = `scheduler:${installId}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_OPERATIONS) {
    return false;
  }

  entry.count++;
  return true;
}

class SchedulerApiError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'SchedulerApiError';
    this.code = code;
    this.details = details;
  }
}

const baseSchema = z.object({
  operation: z.enum(['list', 'get', 'create', 'update', 'delete', 'getEndpoints']),
});

const getSchema = baseSchema.extend({
  scheduleId: z.string().uuid(),
});

const createSchema = baseSchema.extend({
  endpoint: z.string().min(1).max(256),
  cron: z.string().min(1).max(128),
  timezone: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
  name: z.string().max(128).optional(),
  payload: z.any().optional(),
});

const updateSchema = baseSchema.extend({
  scheduleId: z.string().uuid(),
  endpoint: z.string().min(1).max(256).optional(),
  cron: z.string().min(1).max(128).optional(),
  timezone: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
  name: z.string().max(128).nullable().optional(),
  payload: z.any().nullable().optional(),
});

const deleteSchema = baseSchema.extend({
  scheduleId: z.string().uuid(),
});

function getStatusForErrorCode(code: string): number {
  switch (code) {
    case 'VALIDATION_FAILED':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'NOT_FOUND':
      return 404;
    case 'QUOTA_EXCEEDED':
    case 'RATE_LIMITED':
      return 429;
    default:
      return 500;
  }
}

function mapError(error: unknown): NextResponse {
  if (error instanceof SchedulerApiError) {
    const status = getStatusForErrorCode(error.code);
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details ?? null },
      { status }
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Validation error', details: error.flatten() },
      { status: 400 }
    );
  }

  console.error('[ext-scheduler-internal] unexpected error', error);
  return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
}

function ensureRunnerAuth(req: NextRequest): void {
  const expected = process.env.RUNNER_STORAGE_API_TOKEN || process.env.RUNNER_SERVICE_TOKEN;
  if (!expected) {
    throw new SchedulerApiError('UNAUTHORIZED', 'Runner token not configured');
  }
  const provided = req.headers.get('x-runner-auth');
  if (!provided || provided !== expected) {
    throw new SchedulerApiError('UNAUTHORIZED', 'Invalid runner token');
  }
}

async function getInstallContext(installId: string): Promise<InstallContext> {
  const config = await getInstallConfigByInstallId(installId);
  if (!config) {
    throw new SchedulerApiError('NOT_FOUND', 'Install not found');
  }

  return {
    tenantId: config.tenantId,
    installId: config.installId,
    versionId: config.versionId,
    registryId: config.registryId,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: RouteParams | Promise<RouteParams> }
) {
  try {
    ensureRunnerAuth(req);

    const raw = await req.json().catch(() => {
      throw new SchedulerApiError('VALIDATION_FAILED', 'Invalid JSON body');
    });
    const base = baseSchema.parse(raw);
    const { installId } = await resolveParams(params);

    // Apply rate limiting for mutating operations
    if (!checkRateLimit(installId, base.operation)) {
      throw new SchedulerApiError('RATE_LIMITED', 'Too many requests, please try again later');
    }

    const ctx = await getInstallContext(installId);

    switch (base.operation) {
      case 'list': {
        const schedules = await listSchedules(ctx);
        return NextResponse.json({ schedules }, { status: 200 });
      }

      case 'get': {
        const input = getSchema.parse(raw);
        const schedule = await getSchedule(ctx, input.scheduleId);
        return NextResponse.json({ schedule }, { status: 200 });
      }

      case 'create': {
        const input = createSchema.parse(raw);
        const result = await createSchedule(ctx, {
          endpoint: input.endpoint,
          cron: input.cron,
          timezone: input.timezone,
          enabled: input.enabled,
          name: input.name,
          payload: input.payload,
        });
        return NextResponse.json(result, { status: result.success ? 201 : 400 });
      }

      case 'update': {
        const input = updateSchema.parse(raw);
        const result = await updateSchedule(ctx, input.scheduleId, {
          endpoint: input.endpoint,
          cron: input.cron,
          timezone: input.timezone,
          enabled: input.enabled,
          name: input.name,
          payload: input.payload,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'delete': {
        const input = deleteSchema.parse(raw);
        const result = await deleteSchedule(ctx, input.scheduleId);
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'getEndpoints': {
        const endpoints = await getEndpoints(ctx);
        return NextResponse.json({ endpoints }, { status: 200 });
      }

      default:
        return NextResponse.json({ error: 'Unsupported operation' }, { status: 400 });
    }
  } catch (error) {
    return mapError(error);
  }
}
