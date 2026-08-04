/**
 * Deprecated when EXT_UI_HOST_MODE === 'rust'. Retained for legacy mode only.
 *
 * Legacy static file responder used by Next.js route when EXT_UI_HOST_MODE === "nextjs".
 * In rust mode, the unified Rust host under /ext-ui is authoritative.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { NextResponse, NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { contentTypeFor } from 'server/src/lib/extensions/assets/mime';

export function serveFrom(req: NextRequest, dir: string, reqPath: string): NextResponse {
  const mode = (process.env.EXT_UI_HOST_MODE || 'rust').toLowerCase();
  if (mode === 'rust') {
    console.warn(JSON.stringify({
      module: 'assets/serve',
      action: 'deprecated_in_rust_mode',
      note: 'EXT_UI_HOST_MODE is rust; serveFrom() is legacy and should not be used in EE'
    }));
  }

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
  const contentType = contentTypeFor(path);
  headers.set('content-type', contentType);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('etag', etag);
  headers.set('x-content-type-options', 'nosniff');
  if (contentType.startsWith('text/html')) {
    headers.set('content-security-policy', extUiCsp());
  }
  return new NextResponse(buf, { status: 200, headers });
}

const DEFAULT_EXT_UI_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

// Mirrors the Rust host (ee/runner/src/http/ext_ui.rs): EXT_UI_CONTENT_SECURITY_POLICY
// replaces the whole policy; EXT_UI_FRAME_ANCESTORS appends a frame-ancestors directive.
function extUiCsp(): string {
  const override = process.env.EXT_UI_CONTENT_SECURITY_POLICY?.trim();
  if (override) return override;
  const frameAncestors = process.env.EXT_UI_FRAME_ANCESTORS?.trim();
  if (frameAncestors) return `${DEFAULT_EXT_UI_CSP}; frame-ancestors ${frameAncestors}`;
  return DEFAULT_EXT_UI_CSP;
}

function sanitizePath(p: string): string {
  const norm = normalize(p).replace(/^\\+/, '/');
  if (norm.includes('..')) return 'index.html';
  return norm.startsWith('/') ? norm.slice(1) : norm;
}

