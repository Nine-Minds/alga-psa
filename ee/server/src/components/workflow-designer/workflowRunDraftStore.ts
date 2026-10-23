/**
 * The Run dialog's unsent test payload, kept per workflow so closing the dialog (Escape, Close, a
 * click outside) never loses it: reopening brings the draft back until it is cleared or sent.
 *
 * Drafts live in sessionStorage (this tab, this browser session). When storage is unavailable
 * (private windows, blocked site data) they fall back to memory for the life of the page.
 */

export type WorkflowRunDraft = {
  /** Which form the draft belongs to (schema source + schema ref); a draft for another form is ignored. */
  formKey: string;
  payload: unknown;
  /** Payload paths the person typed into, so record picks keep respecting them after reopening. */
  editedPaths: string[];
  savedAt: number;
};

const STORAGE_PREFIX = 'workflow-run-draft:';
const memoryDrafts = new Map<string, WorkflowRunDraft>();

const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

const isDraft = (value: unknown): value is WorkflowRunDraft =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as WorkflowRunDraft).formKey === 'string' &&
  Array.isArray((value as WorkflowRunDraft).editedPaths);

export const readWorkflowRunDraft = (workflowId: string, formKey: string): WorkflowRunDraft | null => {
  let draft: WorkflowRunDraft | null = memoryDrafts.get(workflowId) ?? null;
  try {
    const stored = storage()?.getItem(`${STORAGE_PREFIX}${workflowId}`);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isDraft(parsed)) draft = parsed;
    }
  } catch {
    // Unreadable storage: fall back to the in-memory draft.
  }
  return draft && draft.formKey === formKey ? draft : null;
};

export const saveWorkflowRunDraft = (workflowId: string, draft: Omit<WorkflowRunDraft, 'savedAt'>): void => {
  const entry: WorkflowRunDraft = { ...draft, savedAt: Date.now() };
  memoryDrafts.set(workflowId, entry);
  try {
    storage()?.setItem(`${STORAGE_PREFIX}${workflowId}`, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the in-memory draft still covers this page.
  }
};

export const clearWorkflowRunDraft = (workflowId: string): void => {
  memoryDrafts.delete(workflowId);
  try {
    storage()?.removeItem(`${STORAGE_PREFIX}${workflowId}`);
  } catch {
    // Nothing more to clear.
  }
};

/** Identifies the form a draft was typed into. */
export const buildWorkflowRunDraftFormKey = (schemaSource: string, schemaRef: string | null | undefined, eventType?: string | null): string =>
  [schemaSource, schemaRef ?? '', eventType ?? ''].join('|');
