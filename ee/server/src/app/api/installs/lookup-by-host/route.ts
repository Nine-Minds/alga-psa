import { NextResponse } from 'next/server';
import { lookupByHost as lookupByHostAction } from '../../../../lib/actions/installDomainActions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const host = searchParams.get('host') || '';
  if (!host) {
    return NextResponse.json({ error: 'missing host' }, { status: 400 });
  }
  try {
    const result = await lookupByHostAction(host);
    if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[lookup-by-host] error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
