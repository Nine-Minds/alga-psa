import { NextResponse } from 'next/server';
import {
  deleteExtensionSchedule,
  listExtensionSchedules,
  updateExtensionSchedule,
} from '@ee/lib/actions/extensionScheduleActions';
import { requireExtensionApiAccess } from '../../../_auth';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ registryId: string; scheduleId: string }> }) {
  try {
    const auth = await requireExtensionApiAccess('read');
    if (auth) return auth;
    const { registryId, scheduleId } = await ctx.params;
    const schedules = await listExtensionSchedules(registryId);
    const schedule = schedules.find((s) => String((s as any).id) === scheduleId) ?? null;
    if (!schedule) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ schedule });
  } catch (e) {
    console.error('[extensions/schedules/:id] GET error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ registryId: string; scheduleId: string }> }) {
  try {
    const auth = await requireExtensionApiAccess('write');
    if (auth) return auth;
    const { registryId, scheduleId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const result = await updateExtensionSchedule(registryId, scheduleId, body);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (e) {
    console.error('[extensions/schedules/:id] PATCH error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ registryId: string; scheduleId: string }> }) {
  try {
    const auth = await requireExtensionApiAccess('write');
    if (auth) return auth;
    const { registryId, scheduleId } = await ctx.params;
    const result = await deleteExtensionSchedule(registryId, scheduleId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (e) {
    console.error('[extensions/schedules/:id] DELETE error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
