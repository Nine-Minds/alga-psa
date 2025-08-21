import { NextResponse } from 'next/server';
import { validate as validateAction } from '../../../../lib/actions/installDomainActions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenant = searchParams.get('tenant');
  const extension = searchParams.get('extension'); // registry_id
  const hash = searchParams.get('hash') || '';

  if (!tenant || !extension || !hash) {
    return NextResponse.json({ valid: false, error: 'missing or invalid parameters' }, { status: 400 });
  }
  try {
    const out = await validateAction({ tenant, extension, hash });
    return NextResponse.json(out);
  } catch (e) {
    console.error('[installs/validate] error', e);
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
