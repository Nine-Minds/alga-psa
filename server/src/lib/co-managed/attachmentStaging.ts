/**
 * Files chosen for the next shared-ticket message. The composer's footer
 * control writes here; the data source's comment write reads and, only after
 * the message is confirmed saved, clears it. Plain external store (no React) so
 * the data source and the picker share one instance.
 */
export interface StagedFile { key: string; file: File }

export interface AttachmentStaging {
  subscribe: (listener: () => void) => () => void;
  /** Stable between changes (required by `useSyncExternalStore`). */
  getSnapshot: () => readonly StagedFile[];
  add: (files: readonly File[]) => void;
  remove: (key: string) => void;
  clear: () => void;
}

export function createAttachmentStaging(newKey: () => string): AttachmentStaging {
  let files: readonly StagedFile[] = [];
  const listeners = new Set<() => void>();
  const set = (next: readonly StagedFile[]) => { files = next; listeners.forEach(listener => listener()); };
  return {
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => files,
    add: added => { if (added.length) set([...files, ...added.map(file => ({ key: newKey(), file }))]); },
    remove: key => { if (files.some(item => item.key === key)) set(files.filter(item => item.key !== key)); },
    clear: () => { if (files.length) set([]); },
  };
}

/** Identity of the staged set, so a retry of the same message + files replays one operation. */
export const stagedFilesSignature = (files: readonly StagedFile[]): string =>
  JSON.stringify(files.map(({ file }) => [file.name, file.size, file.type, file.lastModified]));
