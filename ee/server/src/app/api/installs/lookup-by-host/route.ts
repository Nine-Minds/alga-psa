import { NextResponse } from 'next/server';
import { lookupByHost as lookupByHostAction } from '@/lib/actions/installDomainActions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const host = searchParams.get('host') || '';
  // Basic request logging with masked auth headers
  try {
    const canary = request.headers.get('x-canary');
    const apiKey = request.headers.get('x-api-key') || '';
    const keyPrefix = apiKey ? apiKey.slice(0, 4) : '';
    const keyLen = apiKey ? apiKey.length : 0;
    console.info('[lookup-by-host] entry', { host, x_canary: canary ?? undefined, api_key_len: keyLen, api_key_prefix: keyPrefix });
  } catch {}
  if (!host) {
    const r = NextResponse.json({ error: 'missing host' }, { status: 400 });
    r.headers.set('Cache-Control', 'no-store');
    r.headers.set('Vary', 'x-api-key, x-canary');
    return r;
  }
  try {
    const result = await lookupByHostAction(host);
    if (!result) {
      try { console.info('[lookup-by-host] not found', { host }); } catch {}
      const r = NextResponse.json({ error: 'not found' }, { status: 404 });
      r.headers.set('Cache-Control', 'no-store');
      r.headers.set('Vary', 'x-api-key, x-canary');
      return r;
    }
    try { console.info('[lookup-by-host] ok', result); } catch {}
    const r = NextResponse.json(result);
    r.headers.set('Cache-Control', 'no-store');
    r.headers.set('Vary', 'x-api-key, x-canary');
    return r;
  } catch (e: any) {
    console.error('[lookup-by-host] error', e);
    const r = NextResponse.json({ error: 'internal error' }, { status: 500 });
    r.headers.set('Cache-Control', 'no-store');
    r.headers.set('Vary', 'x-api-key, x-canary');
    return r;
  }
}
