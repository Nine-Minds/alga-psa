import { NextResponse } from 'next/server';
import {
  createExtensionSchedule,
  listExtensionSchedules,
} from '@ee/lib/actions/extensionScheduleActions';
import { requireExtensionApiAccess } from '../../_auth';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ registryId: string }> }) {
  try {
    const auth = await requireExtensionApiAccess('read');
    if (auth) return auth;
    const { registryId } = await ctx.params;
    const schedules = await listExtensionSchedules(registryId);
    return NextResponse.json({ schedules });
  } catch (e) {
    console.error('[extensions/schedules] GET error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ registryId: string }> }) {
  try {
    const auth = await requireExtensionApiAccess('write');
    if (auth) return auth;
    const { registryId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const result = await createExtensionSchedule(registryId, body);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (e) {
    console.error('[extensions/schedules] POST error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
