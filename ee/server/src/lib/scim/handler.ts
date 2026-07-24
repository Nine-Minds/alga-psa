import type { Knex } from 'knex';
import { Buffer } from 'node:buffer';
import { getAdminConnection } from '@alga-psa/db/admin';
import { tenantDb } from '@alga-psa/db';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import { TIER_FEATURES } from '@alga-psa/types';
import { assertTenantTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';

import { verifyScimToken } from './credentials';
import {
  parsePatchOperations,
  parseScimFilter,
  parseScimUser,
  scimErrorResponse,
  scimJson,
  ScimError,
  SCIM_MEDIA_TYPE,
} from './protocol';
import {
  ScimProvisioningService,
  SCIM_SERVICE_PROVIDER_CONFIG,
  scimResourceTypes,
  scimSchemas,
} from './service';

interface RouteParams {
  connectionId: string;
  scimPath: string[];
}

interface ScimConnection {
  tenant: string;
  connection_id: string;
  enabled: boolean;
  current_token_hash: string | null;
  current_token_generation: number;
  previous_token_hash: string | null;
  previous_token_expires_at: Date | string | null;
}

interface RequestContext {
  knex: Knex;
  connection: ScimConnection;
  service: ScimProvisioningService;
  baseUrl: string;
}

const MAX_BODY_BYTES = 1024 * 1024;

function getSourceAddress(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new ScimError(401, 'Bearer authentication is required.');
  }
  return match[1].trim();
}

async function parseBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ScimError(413, 'The SCIM request body is too large.');
  }

  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    throw new ScimError(413, 'The SCIM request body is too large.');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ScimError(400, 'The SCIM request body is not valid JSON.', 'invalidSyntax');
  }
}

function safeInteger(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function authenticate(request: Request, params: RouteParams): Promise<RequestContext> {
  const knex = await getAdminConnection();
  const discoveryDb = tenantDb(knex, '__scim_connection_discovery__');
  const connection = await discoveryDb
    .unscoped<ScimConnection>(
      'scim_connections',
      'SCIM connection id discovers tenant before bearer authentication'
    )
    .where('connection_id', params.connectionId)
    .first();

  // Use the same public response for unknown, disabled, and invalid-credential
  // connections so the opaque connection id cannot be enumerated.
  if (!connection) {
    const token = bearerToken(request);
    verifyScimToken(token, null);
    verifyScimToken(token, null);
    throw new ScimError(401, 'Invalid SCIM credentials.');
  }

  const rateLimit = await TokenBucketRateLimiter.getInstance().tryConsume(
    'scim',
    connection.tenant,
    `${connection.connection_id}:${getSourceAddress(request)}`
  );
  if (!rateLimit.allowed) {
    throw new ScimError(429, 'SCIM request rate limit exceeded.');
  }

  const token = bearerToken(request);
  const currentMatches = verifyScimToken(token, connection.current_token_hash);
  const previousMatches = verifyScimToken(token, connection.previous_token_hash);
  const previousActive = Boolean(
    connection.previous_token_expires_at
    && new Date(connection.previous_token_expires_at).getTime() > Date.now()
  );

  if (!connection.enabled || (!currentMatches && !(previousMatches && previousActive))) {
    throw new ScimError(401, 'Invalid SCIM credentials.');
  }

  try {
    await assertTenantTierAccess(connection.tenant, TIER_FEATURES.SCIM_PROVISIONING);
  } catch {
    throw new ScimError(403, 'SCIM provisioning is not available for this tenant.');
  }

  const db = tenantDb(knex, connection.tenant);
  await db.table('scim_connections')
    .where('connection_id', connection.connection_id)
    .update({
      last_authenticated_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

  const url = new URL(request.url);
  const baseUrl = `${url.origin}/api/scim/v2/${connection.connection_id}`;
  return {
    knex,
    connection,
    baseUrl,
    service: new ScimProvisioningService(knex, connection, baseUrl),
  };
}

async function recordRequestResult(
  context: RequestContext,
  result: { success: boolean; code?: string }
): Promise<void> {
  const db = tenantDb(context.knex, context.connection.tenant);
  await db.table('scim_connections')
    .where('connection_id', context.connection.connection_id)
    .update(result.success
      ? {
          last_success_at: context.knex.fn.now(),
          last_error_code: null,
          last_error_detail: null,
          updated_at: context.knex.fn.now(),
        }
      : {
          last_error_code: result.code ?? 'request_failed',
          last_error_detail: 'See sanitized SCIM operation history.',
          updated_at: context.knex.fn.now(),
        });
}

function segments(params: RouteParams): string[] {
  return (params.scimPath ?? []).filter(Boolean);
}

export async function handleScimGet(request: Request, params: RouteParams): Promise<Response> {
  let context: RequestContext | null = null;
  try {
    context = await authenticate(request, params);
    const path = segments(params);
    let body: Record<string, unknown>;

    if (path.length === 1 && path[0] === 'ServiceProviderConfig') {
      body = {
        ...SCIM_SERVICE_PROVIDER_CONFIG,
        meta: {
          resourceType: 'ServiceProviderConfig',
          location: `${context.baseUrl}/ServiceProviderConfig`,
        },
      };
    } else if (path.length === 1 && path[0] === 'Schemas') {
      body = scimSchemas(context.baseUrl);
    } else if (path.length === 1 && path[0] === 'ResourceTypes') {
      body = scimResourceTypes(context.baseUrl);
    } else if (path.length === 1 && path[0] === 'Users') {
      const url = new URL(request.url);
      body = await context.service.listUsers(
        parseScimFilter(url.searchParams.get('filter')),
        safeInteger(url.searchParams.get('startIndex'), 1),
        safeInteger(url.searchParams.get('count'), 100)
      );
    } else if (path.length === 2 && path[0] === 'Users') {
      body = await context.service.getUser(path[1]);
    } else {
      throw new ScimError(404, 'The SCIM resource was not found.');
    }

    await recordRequestResult(context, { success: true });
    return scimJson(body);
  } catch (error) {
    if (context) {
      await recordRequestResult(context, {
        success: false,
        code: error instanceof ScimError ? error.scimType ?? `http_${error.status}` : 'internal_error',
      }).catch(() => undefined);
    }
    return scimErrorResponse(error);
  }
}

export async function handleScimPost(request: Request, params: RouteParams): Promise<Response> {
  let context: RequestContext | null = null;
  try {
    context = await authenticate(request, params);
    const path = segments(params);
    if (path.length !== 1 || path[0] !== 'Users') {
      throw new ScimError(404, 'The SCIM resource was not found.');
    }

    const resource = await context.service.createUser(
      parseScimUser(await parseBody(request))
    );
    const location = (resource.meta as { location?: string } | undefined)?.location;
    await recordRequestResult(context, { success: true });
    return scimJson(resource, 201, location ? { location } : undefined);
  } catch (error) {
    if (context) {
      await recordRequestResult(context, {
        success: false,
        code: error instanceof ScimError ? error.scimType ?? `http_${error.status}` : 'internal_error',
      }).catch(() => undefined);
    }
    return scimErrorResponse(error);
  }
}

export async function handleScimPut(request: Request, params: RouteParams): Promise<Response> {
  let context: RequestContext | null = null;
  try {
    context = await authenticate(request, params);
    const path = segments(params);
    if (path.length !== 2 || path[0] !== 'Users') {
      throw new ScimError(404, 'The SCIM resource was not found.');
    }
    const resource = await context.service.replaceUser(
      path[1],
      parseScimUser(await parseBody(request))
    );
    await recordRequestResult(context, { success: true });
    return scimJson(resource);
  } catch (error) {
    if (context) {
      await recordRequestResult(context, {
        success: false,
        code: error instanceof ScimError ? error.scimType ?? `http_${error.status}` : 'internal_error',
      }).catch(() => undefined);
    }
    return scimErrorResponse(error);
  }
}

export async function handleScimPatch(request: Request, params: RouteParams): Promise<Response> {
  let context: RequestContext | null = null;
  try {
    context = await authenticate(request, params);
    const path = segments(params);
    if (path.length !== 2 || path[0] !== 'Users') {
      throw new ScimError(404, 'The SCIM resource was not found.');
    }
    const resource = await context.service.patchUser(
      path[1],
      parsePatchOperations(await parseBody(request))
    );
    await recordRequestResult(context, { success: true });
    return scimJson(resource);
  } catch (error) {
    if (context) {
      await recordRequestResult(context, {
        success: false,
        code: error instanceof ScimError ? error.scimType ?? `http_${error.status}` : 'internal_error',
      }).catch(() => undefined);
    }
    return scimErrorResponse(error);
  }
}

export async function handleScimDelete(request: Request, params: RouteParams): Promise<Response> {
  let context: RequestContext | null = null;
  try {
    context = await authenticate(request, params);
    const path = segments(params);
    if (path.length !== 2 || path[0] !== 'Users') {
      throw new ScimError(404, 'The SCIM resource was not found.');
    }
    await context.service.deleteUser(path[1]);
    await recordRequestResult(context, { success: true });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (context) {
      await recordRequestResult(context, {
        success: false,
        code: error instanceof ScimError ? error.scimType ?? `http_${error.status}` : 'internal_error',
      }).catch(() => undefined);
    }
    return scimErrorResponse(error);
  }
}

export function handleScimOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'content-type': SCIM_MEDIA_TYPE,
    },
  });
}
