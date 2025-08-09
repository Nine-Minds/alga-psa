import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { NextResponse, NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { contentTypeFor } from 'server/src/lib/extensions/assets/mime';

export function serveFrom(req: NextRequest, dir: string, reqPath: string): NextResponse {
  const safe = sanitizePath(reqPath);
  const full = join(dir, safe);
  let path = full;
  if (!existsSync(path)) {
    path = join(dir, 'index.html');
    if (!existsSync(path)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const buf = readFileSync(path);
  const etag = 'W/"' + createHash('sha1').update(buf).digest('hex') + '"';
  const ifNone = req.headers.get('if-none-match');
  if (ifNone && ifNone === etag) return new NextResponse(null, { status: 304 });
  const headers = new Headers();
  headers.set('content-type', contentTypeFor(path));
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('etag', etag);
  return new NextResponse(buf, { status: 200, headers });
}

function sanitizePath(p: string): string {
  const norm = normalize(p).replace(/^\\+/, '/');
  if (norm.includes('..')) return 'index.html';
  return norm.startsWith('/') ? norm.slice(1) : norm;
}

