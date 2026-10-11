import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** Older internal ticket readers omit kind. Both parent columns are constrained
 * so equal UUIDs in different work tables cannot identify the same attachment. */
export function coManagedAttachmentParent(resource: { kind?: string; id: string }, alias?: string) {
  const kind = resource.kind ?? 'ticket';
  if (!['ticket', 'project_task'].includes(kind) || !isCoManagedUuid(resource.id) || alias && !/^[a-z][a-z0-9_]*$/.test(alias)) throw new CoManagedSharedWorkError();
  const prefix = alias ? `${alias}.` : '';
  return { [`${prefix}ticket_id`]: kind === 'ticket' ? resource.id : null,
    [`${prefix}project_task_id`]: kind === 'project_task' ? resource.id : null };
}
