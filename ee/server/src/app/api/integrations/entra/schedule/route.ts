import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import {
  getEntraSyncSchedule,
  saveEntraSyncSchedule,
} from '@ee/lib/integrations/entra/scheduleService';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  return ok(await getEntraSyncSchedule(accessGate.tenantId));
}

export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await parseJsonBody(request);
  if (typeof body.syncEnabled !== 'boolean') {
    return badRequest('syncEnabled must be a boolean');
  }

  const intervalRaw = body.syncIntervalMinutes;
  if (intervalRaw !== undefined && !Number.isFinite(Number(intervalRaw))) {
    return badRequest('syncIntervalMinutes must be a number of minutes');
  }

  const saved = await saveEntraSyncSchedule({
    tenantId: accessGate.tenantId,
    syncEnabled: body.syncEnabled,
    syncIntervalMinutes: Number(intervalRaw ?? 1440),
  });

  return ok(saved);
}
