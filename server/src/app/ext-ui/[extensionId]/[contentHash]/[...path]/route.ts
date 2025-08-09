import { NextRequest, NextResponse } from 'next/server';
import { ensureUiCached } from 'server/src/lib/extensions/assets/cache';
import { serveFrom } from 'server/src/lib/extensions/assets/serve';
import { getTenantFromAuth } from 'server/src/lib/extensions/gateway/auth';
import { getTenantInstall, resolveVersion } from 'server/src/lib/extensions/gateway/registry';

export async function GET(req: NextRequest, ctx: { params: { extensionId: string; contentHash: string; path?: string[] } }) {
  const { extensionId, contentHash } = ctx.params;
  // Validate that this contentHash matches the caller's active install for this extension.
  try {
    const tenantId = await getTenantFromAuth(req);
    const install = await getTenantInstall(tenantId, extensionId);
    if (!install) return NextResponse.json({ error: 'not_installed' }, { status: 404 });
    const { content_hash } = await resolveVersion(install);
    const reqHash = contentHash.replace('sha256:', '');
    const activeHash = (content_hash || '').replace('sha256:', '');
    if (!activeHash || activeHash !== reqHash) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
  } catch {
    // Avoid leaking details; 404 on auth/lookup failure
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const dir = await ensureUiCached(contentHash);
  const subpath = '/' + (ctx.params.path || []).join('/');
  return serveFrom(req, dir, subpath);
}
