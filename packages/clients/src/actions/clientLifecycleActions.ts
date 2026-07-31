'use server';

import { createTenantKnex, registerAfterCommit, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildClientStatusChangedPayload } from '@alga-psa/workflow-streams';
import type { ClientLifecycleStatus, IClient } from '@alga-psa/types';
import { ClientLifecycleStatusSchema } from '../schemas/client.schema';

export const setClientLifecycleStatus = withAuth(async (
  user,
  { tenant },
  clientId: string,
  lifecycleStatus: ClientLifecycleStatus,
): Promise<IClient> => {
  if (!await hasPermission(user as any, 'client', 'update')) {
    throw new Error('Permission denied: client update required');
  }
  const nextStatus = ClientLifecycleStatusSchema.parse(lifecycleStatus);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const current = await db.table('clients').where({ client_id: clientId }).forUpdate().first<IClient>();
    if (!current) throw new Error('Client not found');
    if (current.lifecycle_status === nextStatus) return current;
    const changedAt = new Date().toISOString();
    const [updated] = await db.table('clients').where({ client_id: clientId }).update({ lifecycle_status: nextStatus, updated_at: changedAt }).returning('*') as IClient[];
    const payload = buildClientStatusChangedPayload({ clientId, previousStatus: current.lifecycle_status ?? 'active', newStatus: nextStatus, changedAt });
    registerAfterCommit(trx, () => publishWorkflowEvent({
      eventType: 'CLIENT_STATUS_CHANGED', payload, ctx: { tenantId: tenant, occurredAt: changedAt, actor: { actorType: 'USER', actorUserId: user.user_id } },
      idempotencyKey: `client_status_changed:${clientId}:${changedAt}`,
    }), `CLIENT_STATUS_CHANGED client=${clientId}`);
    return updated;
  });
});
