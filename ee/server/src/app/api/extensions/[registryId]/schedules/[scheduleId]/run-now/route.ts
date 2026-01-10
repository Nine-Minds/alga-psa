import { NextResponse } from 'next/server';
import { runExtensionScheduleNow } from '@ee/lib/actions/extensionScheduleActions';
import { requireExtensionApiAccess } from '../../../../_auth';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, ctx: { params: Promise<{ registryId: string; scheduleId: string }> }) {
  try {
    const auth = await requireExtensionApiAccess('write');
    if (auth) return auth;
    const { registryId, scheduleId } = await ctx.params;
    const result = await runExtensionScheduleNow(registryId, scheduleId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (e) {
    console.error('[extensions/schedules/:id/run-now] POST error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
