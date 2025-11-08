/**
 * NOTE: This file lives under ee/server, but the active Next.js App Router for the
 * application is rooted at server/src/app.
 *
 * To avoid multiple app router roots, the real `/api/ext-debug/stream` route MUST be
 * implemented under:
 *
 *   server/src/app/api/ext-debug/stream/route.ts
 *
 * using the existing edition/EE routing patterns (see other extension gateway routes).
 *
 * This EE-local file is intentionally a stub and always returns 404 to make it explicit
 * that callers should use the main server/src/app router, not ee/server.
 */

import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'ext_debug_stream_not_available_in_ee_server_app',
      hint:
        'Implement /api/ext-debug/stream under server/src/app with shared edition-aware routing; ee/server/src/app cannot host a separate App Router.',
    }),
    {
      status: 404,
      headers: {
        'content-type': 'application/json',
      },
    }
  );
}
