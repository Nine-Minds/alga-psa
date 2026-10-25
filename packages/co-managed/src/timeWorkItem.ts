import type { Knex } from 'knex';
import type { CoManagedSessionActor, CoManagedSharedResource } from './sharedWork';
import { registerCoManagedTimeWorkReference } from './timeWorkReference';
import { withCoManagedCustomerProject, withCoManagedCustomerTicket } from './customerWork';
import { admitCoManagedNativeTimeSource } from './nativeTimeEntryAccess';
import { CoManagedSharedWorkError, snapshotCoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface CoManagedTimeWorkItem {
  workItemType: 'ticket' | 'project_task' | 'co_managed';
  workItemId: string;
  workItemName: string | null;
}

/** Resolve qualified collaboration work to the identity owned by the time writer. */
export async function resolveCoManagedTimeWorkItem(db: Knex, actor: CoManagedSessionActor,
  resource: CoManagedSharedResource): Promise<CoManagedTimeWorkItem> {
  actor = snapshotCoManagedSessionActor(actor);
  if (!resource || !['ticket', 'project_task'].includes(resource.kind)) throw new CoManagedSharedWorkError();
  if (actor.tenant !== resource.tenant) {
    const work = await registerCoManagedTimeWorkReference(db, actor, resource);
    return { workItemType: 'co_managed', workItemId: work.referenceId, workItemName: work.title };
  }
  const retain = resource.kind === 'ticket' ? withCoManagedCustomerTicket : withCoManagedCustomerProject;
  return retain(db, actor, resource, 'update', async context => {
    const workItemType = context.resource.kind === 'ticket' ? 'ticket' : 'project_task';
    // Use the same source/time authority as native saves. Local operational
    // work never needs a sponsor client or a commercial work reference.
    const access = await admitCoManagedNativeTimeSource(context.trx, actor, {
      user_id: actor.userId, work_item_type: workItemType, work_item_id: context.resource.id,
    }, 'create');
    const fields = context.redactedFields;
    if (isCoManagedReadFieldHidden(fields, ['time_entries', 'work_item_id', workItemType === 'ticket' ? 'ticket_id' : 'task_id'])) {
      throw new CoManagedSharedWorkError();
    }
    const hiddenName = isCoManagedReadFieldHidden(fields, ['name', 'title', 'task_name', 'values.task_name', 'tickets.title', 'project_tasks.task_name']);
    await access.assertCurrent();
    return { workItemType, workItemId: context.resource.id, workItemName: hiddenName ? null : access.workItem.name || null };
  });
}
