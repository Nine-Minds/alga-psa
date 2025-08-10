import { NextRequest, NextResponse } from 'next/server';
import { ensureUiCached } from 'server/src/lib/extensions/assets/cache';
import { serveFrom } from 'server/src/lib/extensions/assets/serve';
import { getTenantFromAuth } from 'server/src/lib/extensions/gateway/auth';
import { getTenantInstall, resolveVersion } from 'server/src/lib/extensions/gateway/registry';

/**
 * ext-ui route gate
 *
 * When EXT_UI_HOST_MODE === "rust" (default), this route must not serve assets in EE.
 * - Option A (default): 404 JSON with no-store to avoid shadowing Rust host/CDN.
 * - Option B (compat): if REDIRECT_COMPAT=true and RUNNER_PUBLIC_BASE set, 308 redirect to Rust host.
 * When EXT_UI_HOST_MODE === "nextjs", preserve legacy behavior (validate contentHash and serve with immutable caching via serveFrom()).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: { extensionId: string; contentHash: string; path?: string[] } }
) {
  const { extensionId, contentHash } = ctx.params;

  const mode = (process.env.EXT_UI_HOST_MODE || 'rust').toLowerCase();
  const runnerBase = process.env.RUNNER_PUBLIC_BASE || '';
  const redirectCompat = String(process.env.REDIRECT_COMPAT || '').toLowerCase() === 'true';

  // Structured log context
  const logCtx = {
    route: 'ext-ui',
    mode,
    extensionId,
    contentHash,
  };

  if (mode === 'rust') {
    // In rust mode, do not serve from Next.js.
    try {
      if (redirectCompat && runnerBase) {
        // Build target URL preserving path and query string
        const incoming = new URL(req.url);
        const subpath = (ctx.params.path || []).join('/');
        const suffix = `/ext-ui/${encodeURIComponent(extensionId)}/${encodeURIComponent(
          contentHash
        )}/${subpath}`;
        // Preserve query string
        const target = new URL(suffix + (incoming.search || ''), runnerBase);

        console.info(
          JSON.stringify({ ...logCtx, action: 'redirect_compat_308', target: target.toString() })
        );
        return NextResponse.redirect(target, 308);
      }

      // Default: hard 404 JSON with no-store and explicit content-type
      console.info(JSON.stringify({ ...logCtx, action: 'rust_mode_404' }));
      return NextResponse.json(
        {
          error: 'ext-ui served by Rust host; see RUNNER_PUBLIC_BASE',
        },
        {
          status: 404,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
          },
        }
      );
    } catch (e) {
      // Defensive: still return no-store 404 if any error occurs constructing redirect
      console.error(JSON.stringify({ ...logCtx, action: 'rust_mode_404_error', error: String(e) }));
      return NextResponse.json(
        { error: 'ext-ui served by Rust host' },
        {
          status: 404,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
          },
        }
      );
    }
  }

  // Legacy nextjs mode: retain existing validation and serving behavior
  // Validate that this contentHash matches the caller's active install for this extension.
  try {
    const tenantId = await getTenantFromAuth(req);
    const install = await getTenantInstall(tenantId, extensionId);
    if (!install) {
      console.warn(JSON.stringify({ ...logCtx, action: 'legacy_not_installed_404' }));
      return NextResponse.json({ error: 'not_installed' }, { status: 404 });
    }
    const { content_hash } = await resolveVersion(install);
    const reqHash = contentHash.replace('sha256:', '');
    const activeHash = (content_hash || '').replace('sha256:', '');
    if (!activeHash || activeHash !== reqHash) {
      console.warn(JSON.stringify({ ...logCtx, action: 'legacy_hash_mismatch_404' }));
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
  } catch (e) {
    // Avoid leaking details; 404 on auth/lookup failure
    console.warn(JSON.stringify({ ...logCtx, action: 'legacy_auth_or_lookup_404', error: String(e) }));
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Serve from local cache path with immutable caching behavior handled by serveFrom()
  const dir = await ensureUiCached(contentHash);
  const subpath = '/' + (ctx.params.path || []).join('/');
  console.info(JSON.stringify({ ...logCtx, action: 'legacy_serve', subpath }));
  return serveFrom(req, dir, subpath);
}
