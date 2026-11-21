import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** The attachment-parent resolver (PLAN §5 seam). A thread kind owns exactly one parent column on
 * `co_management_conversation_attachments`; every query names both columns so equal UUIDs in
 * different work tables can never identify the same attachment. L4b registers `ticket` only;
 * L4c registers `project_task` (its column already exists) together with its own thread branch. */
const PARENT_COLUMNS = ['ticket_id', 'project_task_id'] as const;
const threadKinds = new Map<string, (typeof PARENT_COLUMNS)[number]>([['ticket', 'ticket_id']]);

export function registerAttachmentThreadKind(kind: string, parentColumn: (typeof PARENT_COLUMNS)[number]): void {
  if (!/^[a-z][a-z_]*$/.test(kind) || !PARENT_COLUMNS.includes(parentColumn)) throw new CoManagedSharedWorkError();
  threadKinds.set(kind, parentColumn);
}
export function isRegisteredAttachmentThreadKind(kind: unknown): kind is string {
  return typeof kind === 'string' && threadKinds.has(kind);
}
/** Test-only. Restores the shipped registry (ticket only). */
export function resetAttachmentThreadKinds(): void { threadKinds.clear(); threadKinds.set('ticket', 'ticket_id'); }

/** Older internal ticket readers omit kind. Exactly one parent column is non-null. */
export function coManagedAttachmentParent(resource: { kind?: string; id: string }, alias?: string) {
  const kind = resource.kind ?? 'ticket', column = threadKinds.get(kind);
  if (!column || !isCoManagedUuid(resource.id) || alias && !/^[a-z][a-z0-9_]*$/.test(alias)) throw new CoManagedSharedWorkError();
  const prefix = alias ? `${alias}.` : '';
  return Object.fromEntries(PARENT_COLUMNS.map(name => [`${prefix}${name}`, name === column ? resource.id : null])) as Record<string, string | null>;
}
