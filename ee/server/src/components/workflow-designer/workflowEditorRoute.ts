const WORKFLOW_EDITOR_BASE_PATH = '/msp/workflow-editor';
const NEW_WORKFLOW_SEGMENT = 'new';

export const workflowEditorPath = (workflowId: string | null): string =>
  `${WORKFLOW_EDITOR_BASE_PATH}/${workflowId ? encodeURIComponent(workflowId) : NEW_WORKFLOW_SEGMENT}`;

/** The workflow id named by a /msp/workflow-editor/<id> address, or null for /new and other paths. */
export const readWorkflowIdFromEditorPath = (pathname: string | null | undefined): string | null => {
  if (!pathname) return null;
  const match = /^\/msp\/workflow-editor\/([^/]+)\/?$/.exec(pathname);
  if (!match || match[1] === NEW_WORKFLOW_SEGMENT) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/**
 * Point the address bar at a workflow (or /new) without navigating. Passing a null state lets the
 * Next app router's patched replaceState carry over its own history state and update its canonical
 * URL; handing it the current history.state instead bypasses that patch, so Next keeps the old URL
 * and writes it back on its next history update.
 */
export const replaceEditorAddress = (workflowId: string | null): void => {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', workflowEditorPath(workflowId));
};
