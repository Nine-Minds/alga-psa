'use client';

import React, { useMemo, useState } from 'react';
import type { PartialBlock } from '@blocknote/core';
import { TextEditor } from '../editor';
import type { EditorSnippetsConfig } from '../editor/snippets';
import { hasEditorContent } from '../editor/hasEditorContent';
import { useRegisterDismissGuard } from './DismissGuard';
import { useRegisterUnsavedChanges } from '../context/UnsavedChangesContext';
import { Button } from './Button';
import { Label } from './Label';
import { Switch } from './Switch';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';
import { useTranslation } from '../lib/i18n/client';

const DEFAULT_REPLY_BLOCK: PartialBlock[] = [{
  type: 'paragraph',
  props: {
    textAlignment: 'left',
    backgroundColor: 'default',
    textColor: 'default',
  },
  content: [{
    type: 'text',
    text: '',
    styles: {},
  }],
}];

export interface InlineReplyComposerProps {
  id?: string;
  parentCommentId: string;
  roomName: string;
  initialInternal?: boolean;
  showInternalToggle?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  uploadFile?: (file: File, blockId?: string) => Promise<string>;
  searchMentions?: (query: string) => Promise<any[]>;
  /**
   * Extra controls rendered in the editor footer next to "Attach files"
   * (e.g. the ticket comment Cc/Bcc control). Omit it and the composer renders
   * exactly as before.
   */
  footerActions?: React.ReactNode;
  /** Reusable-content library for the editor (canned responses); omit to hide the picker. */
  snippets?: EditorSnippetsConfig;
  /** Blocks Reply while the footer slot holds invalid input. */
  submitDisabled?: boolean;
  onSubmit: (params: {
    parentCommentId: string;
    content: PartialBlock[];
    isInternal: boolean;
  }) => Promise<void> | void;
  onCancel: () => void;
}

export function InlineReplyComposer({
  id,
  parentCommentId,
  roomName,
  initialInternal = false,
  showInternalToggle = true,
  submitLabel,
  cancelLabel,
  isSubmitting = false,
  uploadFile,
  searchMentions,
  footerActions,
  snippets,
  submitDisabled = false,
  onSubmit,
  onCancel,
}: InlineReplyComposerProps): React.ReactElement {
  const { t } = useTranslation('common');
  const componentId = id || `reply-composer-${parentCommentId}`;
  const [isInternal, setIsInternal] = useState(initialInternal);
  const [content, setContent] = useState<PartialBlock[]>(DEFAULT_REPLY_BLOCK);
  const editorInitialContent = useMemo(() => DEFAULT_REPLY_BLOCK, []);

  // A typed reply must survive a stray Escape / overlay click on the drawer or
  // dialog hosting this composer: report it so the container asks before closing.
  // LEVERAGE: pattern composer-dirty-guard — same track-content + two-guard shape as TicketConversation and BentoTimelineTile
  const hasTypedReply = hasEditorContent(content);
  useRegisterDismissGuard(hasTypedReply);
  // On a full page (no Dialog/Drawer) the page-level registry guards ticket
  // navigation and reload instead; a no-op when no UnsavedChangesProvider is mounted.
  useRegisterUnsavedChanges(`inline-reply-composer-${componentId}`, hasTypedReply);

  return (
    // Sticky so replying to a comment taller than the viewport keeps the
    // composer pinned to the bottom edge instead of mounting off-screen —
    // same behavior as the top/bottom add-comment docks.
    <div
      {...withDataAutomationId({ id: componentId })}
      className="inline-reply-composer sticky bottom-2 z-10 rounded-lg border border-gray-200 bg-gray-50 p-3 shadow-lg"
    >
      {showInternalToggle && (
        <div className="mb-2 flex items-center gap-2">
          <Switch
            id={`${componentId}-internal-toggle`}
            checked={isInternal}
            onCheckedChange={setIsInternal}
          />
          <Label htmlFor={`${componentId}-internal-toggle`}>{t('inlineReplyComposer.fields.internal.label', { defaultValue: 'Mark as Internal' })}</Label>
        </div>
      )}
      <TextEditor
        allowFileAttachments={roomName?.startsWith('ticket-')}
        {...withDataAutomationId({ id: `${componentId}-editor` })}
        roomName={roomName}
        initialContent={editorInitialContent}
        onContentChange={setContent}
        searchMentions={searchMentions}
        uploadFile={uploadFile}
        footerActions={footerActions}
        snippets={snippets}
        autoFocus
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          id={`${componentId}-submit`}
          type="button"
          onClick={() => onSubmit({ parentCommentId, content, isInternal })}
          disabled={isSubmitting || submitDisabled}
        >
          {submitLabel ?? t('inlineReplyComposer.actions.reply', { defaultValue: 'Reply' })}
        </Button>
        <Button
          id={`${componentId}-cancel`}
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {cancelLabel ?? t('actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
      </div>
    </div>
  );
}

export default InlineReplyComposer;
