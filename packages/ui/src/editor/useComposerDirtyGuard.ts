import { useCallback, useState } from 'react';
import type { PartialBlock } from '@blocknote/core';
import { hasEditorContent } from './hasEditorContent';
import { useRegisterDismissGuard } from '../components/DismissGuard';
import { useRegisterUnsavedChanges } from '../context/UnsavedChangesContext';

export interface ComposerDirtyGuard {
  /** Whether the editor currently holds text a reader would be upset to lose. */
  hasContent: boolean;
  /** Feed every editor content change through this. */
  trackContent: (content: PartialBlock[] | null | undefined) => void;
  /** The composer was emptied, discarded or remounted fresh. */
  clear: () => void;
}

/**
 * The dirty guard every reply/comment composer registers: track whether the editor holds text, and while
 * `open` and dirty, report it to the surrounding Dialog/Drawer (Escape / overlay click asks first) and to
 * the page-level registry (ticket navigation and reload confirm; a no-op without an UnsavedChangesProvider).
 * `unsavedKey` identifies this composer in the page-level registry.
 */
export function useComposerDirtyGuard(open: boolean, unsavedKey: string): ComposerDirtyGuard {
  const [hasContent, setHasContent] = useState(false);
  useRegisterDismissGuard(open && hasContent);
  useRegisterUnsavedChanges(unsavedKey, open && hasContent);
  const trackContent = useCallback((content: PartialBlock[] | null | undefined) => {
    setHasContent(hasEditorContent(content));
  }, []);
  const clear = useCallback(() => setHasContent(false), []);
  return { hasContent, trackContent, clear };
}
