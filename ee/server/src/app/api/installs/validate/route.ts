import { NextResponse } from 'next/server';
import { validate as validateAction } from '../../../../lib/actions/installDomainActions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenant = searchParams.get('tenant');
  const extension = searchParams.get('extension'); // registry_id
  const hash = searchParams.get('hash') || '';
  // Request logging with masked auth headers
  try {
    const canary = request.headers.get('x-canary');
    const apiKey = request.headers.get('x-api-key') || '';
    const keyPrefix = apiKey ? apiKey.slice(0, 4) : '';
    const keyLen = apiKey ? apiKey.length : 0;
    console.info('[installs/validate] entry', { tenant, extension, hash, x_canary: canary ?? undefined, api_key_len: keyLen, api_key_prefix: keyPrefix });
  } catch {}

  if (!tenant || !extension || !hash) {
    return NextResponse.json({ valid: false, error: 'missing or invalid parameters' }, { status: 400 });
  }
  try {
    const out = await validateAction({ tenant, extension, hash });
    try { console.info('[installs/validate] ok', out); } catch {}
    return NextResponse.json(out);
  } catch (e) {
    console.error('[installs/validate] error', e);
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
