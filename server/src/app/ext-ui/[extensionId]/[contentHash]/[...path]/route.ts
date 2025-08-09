import { NextRequest } from 'next/server';
import { ensureUiCached } from 'server/src/lib/extensions/assets/cache';
import { serveFrom } from 'server/src/lib/extensions/assets/serve';

export async function GET(req: NextRequest, ctx: { params: { extensionId: string; contentHash: string; path?: string[] } }) {
  const { contentHash } = ctx.params;
  const dir = await ensureUiCached(contentHash);
  const subpath = '/' + (ctx.params.path || []).join('/');
  return serveFrom(req, dir, subpath);
}

