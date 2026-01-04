import { NextResponse } from 'next/server';
import { getExtensionApiEndpoints } from '@ee/lib/actions/extensionActions';
import { requireExtensionApiAccess } from '../../_auth';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ registryId: string }> }) {
  try {
    const auth = await requireExtensionApiAccess('read');
    if (auth) return auth;
    const { registryId } = await ctx.params;
    const endpoints = await getExtensionApiEndpoints(registryId);
    return NextResponse.json({ endpoints });
  } catch (e) {
    console.error('[extensions/endpoints] error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
