/**
 * The ONE redaction function for project task comments.
 *
 * A customer's project policy may hide a task comment's author, its revision, or the identity of
 * its reactors from a given reader. Every surface that emits a task comment (the web actions/UI,
 * the REST `ProjectTaskCommentService`; the search indexer emits no author, revision or reactor fields at all, so it has nothing to redact) must pass the comment through
 * `redactTaskComment` rather than deleting fields locally, so a field hidden on one surface can
 * never be learned from another. Hiding the reactor keeps the reaction count (it is only
 * visible inside the audience in the first place).
 */
export interface TaskCommentFieldPolicy {
  hideAuthor: boolean;
  hideRevision: boolean;
  /** Hides who reacted; the aggregate count stays. */
  hideReactors: boolean;
}

export const TASK_COMMENT_SHOW_ALL: TaskCommentFieldPolicy = { hideAuthor: false, hideRevision: false, hideReactors: false };

/** Build a policy from a reader's "is this field source hidden" predicate (the co-managed `hidden(taskId, fields)`). */
export function taskCommentFieldPolicy(hidden: (fields: readonly string[]) => boolean): TaskCommentFieldPolicy {
  return { hideAuthor: hidden(['author']), hideRevision: hidden(['revision']), hideReactors: hidden(['reactions']) };
}

/** Returns a copy; the input is never mutated. Tombstones also lose their body here. */
export function redactTaskComment<T extends object>(comment: T, policy: TaskCommentFieldPolicy): T {
  const out: Record<string, unknown> = { ...(comment as Record<string, unknown>) };
  if (policy.hideAuthor) {
    for (const key of ['userId', 'user_id', 'actorReferenceId', 'contactId', 'avatarUrl', 'organizationName', 'author']) {
      if (key in out) out[key] = null;
    }
    for (const key of ['firstName', 'lastName', 'email']) if (key in out) out[key] = '';
    // A hidden author must not be readable from ownership affordances either.
    if ('canEdit' in out) out.canEdit = false;
  }
  if (policy.hideRevision) {
    if ('collaborationRevision' in out) delete out.collaborationRevision;
    if ('revision' in out) out.revision = null;
    if ('canEdit' in out) out.canEdit = false;
    if ('canReply' in out) out.canReply = false;
  }
  return out as T;
}

export interface RedactableReactions {
  reactions: Record<string, Array<{ userIds?: string[] }>>;
  userNames: Record<string, string>;
}

/** Same single policy applied to a reactions batch: counts stay, reactor identities go. */
export function redactTaskCommentReactions<T extends RedactableReactions>(batch: T, policy: TaskCommentFieldPolicy): T {
  if (!policy.hideReactors) return batch;
  const reactions: RedactableReactions['reactions'] = {};
  for (const [commentId, list] of Object.entries(batch.reactions)) {
    reactions[commentId] = list.map(reaction => ({ ...reaction, ...(reaction.userIds ? { userIds: [] } : {}) }));
  }
  return { ...batch, reactions, userNames: {} };
}
