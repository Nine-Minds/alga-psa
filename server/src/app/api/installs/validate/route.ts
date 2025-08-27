import { NextRequest, NextResponse } from 'next/server';
import { validate } from '@ee/lib/actions/installDomainActions';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') || '';
  const extension = url.searchParams.get('extension') || '';
  const hash = url.searchParams.get('hash') || '';

  try {
    const out = await validate({ tenant, extension, hash });
    return NextResponse.json(out, { status: 200 });
  } catch (e: any) {
    console.error('[installs/validate] error', e?.message || String(e));
    return NextResponse.json({ valid: false }, { status: 200 });
  }
}

