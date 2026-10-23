/**
 * CE stub for the smart search stream. The real handler is
 * ee/server/src/app/api/smart-search/[entity]/stream/route.ts, reached through
 * the edition-swapped `@enterprise` alias by the delegator in
 * server/src/app/api/smart-search/[entity]/stream/route.ts.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  return new Response(
    JSON.stringify({
      code: 'ENTERPRISE_EDITION_REQUIRED',
      error: 'Smart search is only available in Enterprise Edition',
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
}
