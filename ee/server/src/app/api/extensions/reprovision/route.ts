import { NextResponse } from 'next/server';
import { reprovisionExtension } from '@ee/lib/actions/extensionDomainActions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const extensionId: string | undefined = body?.extensionId;
    if (!extensionId) return NextResponse.json({ error: 'missing extensionId' }, { status: 400 });

    const out = await reprovisionExtension(extensionId);
    return NextResponse.json(out);
  } catch (e) {
    console.error('[extensions/reprovision] error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
