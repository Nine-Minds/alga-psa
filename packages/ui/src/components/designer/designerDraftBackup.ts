/**
 * A copy of unsaved designer edits kept in this browser, so a lost session, crash, or reload
 * doesn't throw them away. It is a convenience only: storage can be unavailable (private mode,
 * blocked site data), so every access is guarded and failures are ignored.
 *
 * Promoted from the workflow designer; the storage namespace is now the caller's.
 */
export type DesignerDraftBackup<TDefinition = unknown> = {
  /** The edited definition. */
  definition: TDefinition;
  /** The saved draft the edits started from; null for a draft that was never saved. */
  baseDefinition: TDefinition | null;
  /** When the backup was written (ISO 8601). */
  savedAt: string;
};

export const designerDraftBackupKey = (
  namespace: string,
  draftId: string | null | undefined
): string => `alga.${namespace}.draftBackup.${draftId || 'new'}`;

const getStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const writeDesignerDraftBackup = <TDefinition>(
  namespace: string,
  draftId: string | null | undefined,
  backup: DesignerDraftBackup<TDefinition>
): void => {
  try {
    getStorage()?.setItem(designerDraftBackupKey(namespace, draftId), JSON.stringify(backup));
  } catch {
    // Storage full or blocked: the backup is best-effort.
  }
};

export const readDesignerDraftBackup = <TDefinition>(
  namespace: string,
  draftId: string | null | undefined
): DesignerDraftBackup<TDefinition> | null => {
  try {
    const raw = getStorage()?.getItem(designerDraftBackupKey(namespace, draftId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DesignerDraftBackup<TDefinition>>;
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

export const clearDesignerDraftBackup = (
  namespace: string,
  draftId: string | null | undefined
): void => {
  try {
    getStorage()?.removeItem(designerDraftBackupKey(namespace, draftId));
  } catch {
    // Ignore: nothing to clean up if storage is unavailable.
  }
};

/**
 * Whether a backup should be offered for restore: it must hold edits (differ from what is saved)
 * and must have been made on top of the version that is saved now. If the draft was saved
 * again since (here or elsewhere), restoring would overwrite newer work, so it isn't offered.
 */
export const shouldOfferDesignerDraftBackup = <TDefinition>(
  backup: DesignerDraftBackup<TDefinition> | null,
  savedDefinition: TDefinition | null,
  isEqual: (left: unknown, right: unknown) => boolean
): boolean => {
  if (!backup) return false;
  if (isEqual(backup.definition, savedDefinition)) return false;
  return isEqual(backup.baseDefinition, savedDefinition);
};
