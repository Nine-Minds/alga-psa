import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { getTenantFromAuth, assertAccess } from 'server/src/lib/extensions/gateway/auth';
import { getTenantInstall, resolveVersion } from 'server/src/lib/extensions/gateway/registry';
import { filterRequestHeaders, filterResponseHeaders } from 'server/src/lib/extensions/gateway/headers';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { createTenantKnex } from 'server/src/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'content-type,x-request-id,x-idempotency-key,x-alga-tenant';

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

type EeInstallConfigModule = {
  getInstallConfig: (params: { tenantId: string; extensionId: string }) => Promise<{
    installId: string;
    versionId: string;
    contentHash: string;
    providers?: string[];
    secretEnvelope?: unknown;
    config?: Record<string, string>;
  } | null>;
};

type InstallContext = {
  installId: string;
  versionId: string;
  contentHash: string;
  providers: string[];
  secretEnvelope?: unknown;
  config: Record<string, string>;
};

let eeInstallConfigPromise: Promise<EeInstallConfigModule | null> | null = null;

async function loadEeInstallConfigModule(): Promise<EeInstallConfigModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }
  if (!eeInstallConfigPromise) {
    eeInstallConfigPromise = import('@ee/lib/extensions/installConfig')
      .then((mod) => mod as EeInstallConfigModule)
      .catch((error) => {
        console.error('[api/ext] failed to load EE installConfig module', error);
        return null;
      });
  }
  return eeInstallConfigPromise;
}

async function resolveInstallContext(tenantId: string, extensionId: string): Promise<InstallContext | null> {
  const eeModule = await loadEeInstallConfigModule();
  if (eeModule?.getInstallConfig) {
    try {
      const config = await eeModule.getInstallConfig({ tenantId, extensionId });
      console.log('[api/ext] EE install config fetched', {
        tenantId,
        extensionId,
        hasConfig: !!config,
        installId: config?.installId,
        versionId: config?.versionId,
        contentHash: config?.contentHash,
      });
      if (config?.contentHash) {
        return {
          installId: config.installId,
          versionId: config.versionId,
          contentHash: config.contentHash,
          providers: config.providers ?? [],
          secretEnvelope: config.secretEnvelope,
          config: config.config ?? {},
        };
      }
      if (config && !config.contentHash) {
        console.warn('[api/ext] EE install config missing content hash', {
          tenantId,
          extensionId,
          installId: config.installId,
          versionId: config.versionId,
        });
      }
    } catch (error) {
      console.error('[api/ext] failed to read install config via EE module', error);
    }
  }

  const install = await getTenantInstall(tenantId, extensionId);
  if (!install) {
    return null;
  }
  const { content_hash, version_id, install_id } = await resolveVersion(install);
  console.log('[api/ext] resolved install via registry', {
    tenantId,
    extensionId,
    installId: install_id,
    versionId: version_id,
    contentHash: content_hash,
  });
  if (!content_hash) {
    return null;
  }
  return {
    installId: install_id,
    versionId: version_id,
    contentHash: content_hash,
    providers: [],
    config: {},
  };
}

interface UserInfo {
  user_id: string;
  user_email: string;
  user_name: string;
  company_name: string;
  user_type: string;
}

async function getUserInfo(tenantId: string): Promise<UserInfo | null> {
  const start = Date.now();
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser || !currentUser.tenant || currentUser.tenant !== tenantId) {
      console.log('[api/ext] getUserInfo: no user or tenant mismatch');
      return null;
    }

    // Fetch tenant company name
    let companyName = '';
    try {
      const { knex } = await createTenantKnex();
      const tenant = await knex('tenants')
        .select('client_name')
        .where('tenant', tenantId)
        .first();
      companyName = tenant?.client_name || '';
    } catch (err) {
      console.error('[api/ext] Failed to fetch tenant company name:', err);
    }

    const info = {
      user_id: currentUser.user_id,
      user_email: currentUser.email || '',
      user_name: `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim(),
      company_name: companyName,
      user_type: currentUser.user_type,
    };
    console.log('[api/ext] getUserInfo completed', { elapsed: Date.now() - start });
    return info;
  } catch (err) {
    console.error('[api/ext] Failed to get user info:', err);
    return null;
  }
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function extraAllowedOrigins(): string[] {
  const raw = process.env.EXT_GATEWAY_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function pickCorsOrigin(req: NextRequest): string | null {
  const originHeader = req.headers.get('origin');
  if (!originHeader) return null;
  return originHeader;
}

function applyCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  if (!origin) return response;
  response.headers.set('access-control-allow-origin', origin);
  response.headers.set('access-control-allow-credentials', 'true');
  const vary = response.headers.get('vary');
  response.headers.set('vary', vary ? `${vary}, Origin` : 'Origin');
  return response;
}

function corsPreflight(origin: string | null): NextResponse {
  const headers = new Headers();
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
  }
  headers.set('access-control-allow-methods', ALLOWED_METHODS);
  headers.set('access-control-allow-headers', ALLOWED_HEADERS);
  headers.set('access-control-max-age', '180');
  headers.set('vary', 'Origin, Access-Control-Request-Headers');
  return new NextResponse(null, { status: 204, headers });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ extensionId: string; path?: string[] }> }) {
  const start = Date.now();
  console.log('[api/ext] incoming request', {
    url: req.url,
    method: req.method,
    headers: {
      origin: req.headers.get('origin'),
      host: req.headers.get('host'),
      'x-alga-tenant': req.headers.get('x-alga-tenant'),
    },
  });
  const corsOrigin = pickCorsOrigin(req);
  if (req.method.toUpperCase() === 'OPTIONS') {
    console.log('[api/ext] handling preflight', { origin: corsOrigin, url: req.url });
    return corsPreflight(corsOrigin);
  }

  const resolvedParams = await ctx.params;
  const { extensionId } = resolvedParams;
  const method = req.method.toUpperCase();
  const path = '/' + (resolvedParams.path || []).join('/');

  try {
    const tenantId = await getTenantFromAuth(req);
    console.log('[api/ext] tenant resolved', { tenantId, extensionId, method, elapsed: Date.now() - start });
    await assertAccess(tenantId, extensionId, method, path);

    // Get user info for extension context
    let userInfo: UserInfo | null = null;
    try {
      userInfo = await getUserInfo(tenantId);
      console.log('[api/ext] user info resolved', { hasUserInfo: !!userInfo, userId: userInfo?.user_id, elapsed: Date.now() - start });
    } catch (userInfoError) {
      console.error('[api/ext] failed to get user info', { error: userInfoError, elapsed: Date.now() - start });
    }

    const install = await resolveInstallContext(tenantId, extensionId);
    console.log('[api/ext] install context resolved', {
      hasInstall: !!install,
      installId: install?.installId,
      versionId: install?.versionId,
      contentHash: install?.contentHash,
      providers: install?.providers,
      elapsed: Date.now() - start
    });
    if (!install) {
      return applyCorsHeaders(NextResponse.json({ error: 'not_installed' }, { status: 404 }), corsOrigin);
    }
    const { installId: install_id, contentHash: content_hash, versionId: version_id, providers, secretEnvelope, config } = install;

    const headers = filterRequestHeaders(req.headers);
    headers['x-alga-tenant'] = tenantId;
    headers['x-alga-extension'] = extensionId;
    const maxBody = 10 * 1024 * 1024; // 10MB cap
    let bodyB64: string | undefined;
    if (req.method !== 'GET') {
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > maxBody) {
        return applyCorsHeaders(
          NextResponse.json({ error: 'payload_too_large' }, { status: 413 }),
          corsOrigin
        );
      }
      bodyB64 = buf.toString('base64');
    }
    const requestId = req.headers.get('x-request-id') || crypto.randomUUID();
    const idempotencyKey = req.method === 'GET' ? undefined : (req.headers.get('x-idempotency-key') || requestId);

    const runnerUrl = process.env.RUNNER_BASE_URL || 'http://localhost:8080';
    const timeoutMs = Number(process.env.EXT_GATEWAY_TIMEOUT_MS || '30000');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      console.log('[api/ext] fetching from runner', { runnerUrl, requestId, elapsed: Date.now() - start });
      const resp = await fetch(`${runnerUrl}/v1/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
          'x-alga-tenant': tenantId,
          'x-alga-extension': extensionId,
          ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
        },
        body: JSON.stringify({
          context: {
            request_id: requestId,
            tenant_id: tenantId,
            extension_id: extensionId,
            install_id,
            content_hash,
            version_id,
            config,
          },
          http: { method, path, query: Object.fromEntries(req.nextUrl.searchParams.entries()), headers, body_b64: bodyB64 },
          limits: { timeout_ms: timeoutMs },
          ...(providers?.length ? { providers } : {}),
          ...(secretEnvelope ? { secret_envelope: secretEnvelope } : {}),
          ...(userInfo ? { user: userInfo } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const rawBody = await resp.text();
      console.log('[api/ext] runner response received', { status: resp.status, elapsed: Date.now() - start });
      if (!rawBody) {
        console.error('[api/ext] runner returned empty body', { status: resp.status, requestId, tenantId, extensionId });
        return applyCorsHeaders(
          NextResponse.json(
            { error: 'runner_empty_response', detail: { status: resp.status } },
            { status: 502 }
          ),
          corsOrigin
        );
      }
      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch (parseError) {
        console.error('[api/ext] runner response was not JSON', {
          status: resp.status,
          requestId,
          tenantId,
          extensionId,
          bodyPreview: rawBody.slice(0, 500),
        });
        return applyCorsHeaders(
          NextResponse.json(
            {
              error: 'runner_invalid_response',
              detail: { status: resp.status, bodyPreview: rawBody.slice(0, 500) },
            },
            { status: 502 }
          ),
          corsOrigin
        );
      }
      const respHeaders = new Headers(filterResponseHeaders(resp.headers));
      const body = payload.body_b64 ? Buffer.from(payload.body_b64, 'base64') : undefined;
      return applyCorsHeaders(
        new NextResponse(body, { status: payload.status || resp.status, headers: respHeaders }),
        corsOrigin
      );
    } catch (err) {
      clearTimeout(timeout);
      console.error('[api/ext] runner execution failed', { error: err, requestId, tenantId, extensionId });
      return applyCorsHeaders(
        NextResponse.json({ error: 'bad_gateway', detail: String(err) }, { status: 502 }),
        corsOrigin
      );
    }
  } catch (err) {
    console.error('[api/ext] unhandled error in gateway', {
      error: err,
      extensionId,
      path,
      method,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return applyCorsHeaders(
      NextResponse.json({ error: 'internal_error', detail: String(err) }, { status: 500 }),
      corsOrigin
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
