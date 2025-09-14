import { NextRequest, NextResponse } from 'next/server';
import { lookupByHost } from '@alga-psa/product-extension-actions';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const host = url.searchParams.get('host') || '';
  if (!host) {
    return NextResponse.json({ error: 'missing_host' }, { status: 400 });
  }

  try {
    const out = await lookupByHost(host);
    if (!out) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(out, { status: 200 });
  } catch (e: any) {
    console.error('[installs/lookup-by-host] error', e?.message || String(e));
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
