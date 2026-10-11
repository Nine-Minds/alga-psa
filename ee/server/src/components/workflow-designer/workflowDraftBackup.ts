/**
 * A copy of unsaved designer edits kept in this browser, so a lost session, crash, or reload
 * doesn't throw them away. It is a convenience only: storage can be unavailable (private mode,
 * blocked site data), so every access is guarded and failures are ignored.
 */
export type WorkflowDraftBackup<TDefinition = unknown> = {
  /** The edited definition. */
  definition: TDefinition;
  /** The saved draft the edits started from; null for a workflow that was never saved. */
  baseDefinition: TDefinition | null;
  /** When the backup was written (ISO 8601). */
  savedAt: string;
};

const STORAGE_PREFIX = 'alga.workflowDesigner.draftBackup.';

export const workflowDraftBackupKey = (workflowId: string | null | undefined): string =>
  `${STORAGE_PREFIX}${workflowId || 'new'}`;

const getStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const writeWorkflowDraftBackup = <TDefinition>(
  workflowId: string | null | undefined,
  backup: WorkflowDraftBackup<TDefinition>
): void => {
  try {
    getStorage()?.setItem(workflowDraftBackupKey(workflowId), JSON.stringify(backup));
  } catch {
    // Storage full or blocked: the backup is best-effort.
  }
};

export const readWorkflowDraftBackup = <TDefinition>(
  workflowId: string | null | undefined
): WorkflowDraftBackup<TDefinition> | null => {
  try {
    const raw = getStorage()?.getItem(workflowDraftBackupKey(workflowId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkflowDraftBackup<TDefinition>>;
    if (!parsed || typeof parsed !== 'object' || parsed.definition === undefined || typeof parsed.savedAt !== 'string') {
      return null;
    }
    return {
      definition: parsed.definition as TDefinition,
      baseDefinition: (parsed.baseDefinition ?? null) as TDefinition | null,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
};

export const clearWorkflowDraftBackup = (workflowId: string | null | undefined): void => {
  try {
    getStorage()?.removeItem(workflowDraftBackupKey(workflowId));
  } catch {
    // Ignore: nothing to clean up if storage is unavailable.
  }
};

/**
 * Whether a backup should be offered for restore: it must hold edits (differ from what is saved)
 * and must have been made on top of the version that is saved now. If the workflow was saved
 * again since (here or elsewhere), restoring would overwrite newer work, so it isn't offered.
 */
export const shouldOfferWorkflowDraftBackup = <TDefinition>(
  backup: WorkflowDraftBackup<TDefinition> | null,
  savedDefinition: TDefinition | null,
  isEqual: (left: unknown, right: unknown) => boolean
): boolean => {
  if (!backup) return false;
  if (isEqual(backup.definition, savedDefinition)) return false;
  return isEqual(backup.baseDefinition, savedDefinition);
};
