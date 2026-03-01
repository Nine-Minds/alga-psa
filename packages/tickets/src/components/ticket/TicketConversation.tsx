'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { ArrowUpDown } from 'lucide-react';
import { IComment, ITicket } from '@alga-psa/types';
import { IDocument } from '@alga-psa/types';
import { PartialBlock } from '@blocknote/core';
import RichTextEditorSkeleton from '@alga-psa/ui/components/skeletons/RichTextEditorSkeleton';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

// Dynamic import for TextEditor
const TextEditor = dynamic(() => import('@alga-psa/ui/editor').then((mod) => mod.TextEditor), {
  loading: () => <RichTextEditorSkeleton height="200px" title="Comment Editor" />,
  ssr: false
});

// Import DEFAULT_BLOCK statically since it's just a constant
export const DEFAULT_BLOCK: PartialBlock[] = [{
  type: "paragraph",
  props: {
    textAlignment: "left",
    backgroundColor: "default",
    textColor: "default"
  },
  content: [{
    type: "text",
    text: "",
    styles: {}
  }]
}];
import CommentItem from './CommentItem';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import styles from './TicketDetails.module.css';
import { Button } from '@alga-psa/ui/components/Button';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { getContactAvatarUrlAction, getUserContactId, searchUsersForMentions } from '@alga-psa/users/actions';
import type { CommentContactAuthor, CommentUserAuthor } from '../../lib/commentAuthorResolution';
import { uploadDocument } from '@alga-psa/documents/actions/documentActions';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { deleteDraftClipboardImages } from '../../actions/comment-actions/clipboardImageDraftActions';
import {
  createClipboardImageFilename,
  renameClipboardImageForUpload,
  validateClipboardImageFile,
} from '../../lib/clipboardImageUtils';

interface TicketConversationProps {
  id?: string;
  ticket: ITicket;
  conversations: IComment[];
  documents: IDocument[];
  userMap: Record<string, CommentUserAuthor>;
  contactMap: Record<string, CommentContactAuthor>;
  currentUser: { id: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null | undefined;
  activeTab: string;
  isEditing: boolean;
  currentComment: IComment | null;
  editorKey: number;
  onNewCommentContentChange: (content: PartialBlock[]) => void;
  onAddNewComment: (isInternal: boolean, isResolution: boolean, closeStatusId?: string | null) => Promise<boolean>;
  onTabChange: (tab: string) => void;
  onEdit: (conversation: IComment) => void;
  onSave: (updates: Partial<IComment>) => void;
  onClose: () => void;
  onDelete: (comment: IComment) => void;
  onContentChange: (content: PartialBlock[]) => void;
  hideInternalTab?: boolean; // Optional prop to hide the Internal tab
  isSubmitting?: boolean; // Flag to indicate if a submission is in progress
  overrides?: Record<string, { note?: string; updated_at?: string }>; // Optional local overrides by comment_id
  externalComments?: Array<IComment & { child_ticket_id?: string; child_ticket_number?: string; child_ticket_title?: string; child_client_name?: string }>;
  closedStatusOptions?: { value: string; label: string }[];
  onClipboardImageUploaded?: () => Promise<void> | void;
}

const TicketConversation: React.FC<TicketConversationProps> = ({
  id,
  ticket,
  conversations,
  documents,
  userMap,
  contactMap,
  currentUser,
  activeTab,
  isEditing,
  currentComment,
  editorKey,
  onNewCommentContentChange,
  onAddNewComment,
  onTabChange,
  onEdit,
  onSave,
  onClose,
  onDelete,
  onContentChange,
  hideInternalTab = false,
  isSubmitting = false,
  overrides = {},
  externalComments = [],
  closedStatusOptions = [],
  onClipboardImageUploaded,
}) => {
  const { t } = useTranslation('features/tickets');
  const { t: tCore } = useTranslation('common');
  // Ensure we have a stable id for interactive element ids
  const compId = id || `ticket-${ticket.ticket_id || 'unknown'}-conversation`;
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(false);
  const [isInternalToggle, setIsInternalToggle] = useState(false);
  const [isResolutionToggle, setIsResolutionToggle] = useState(false);
  const NO_STATUS_CHANGE = '__no_status_change__';
  const [resolutionCloseStatusId, setResolutionCloseStatusId] = useState<string>(NO_STATUS_CHANGE);
  const [contactAvatarUrls, setContactAvatarUrls] = useState<Record<string, string | null>>({});
  const [draftClipboardImages, setDraftClipboardImages] = useState<
    Array<{ documentId: string; fileId: string; name: string; url: string }>
  >([]);
  const [showDraftCancelDialog, setShowDraftCancelDialog] = useState(false);
  const [isDeletingDraftImages, setIsDeletingDraftImages] = useState(false);
  const clipboardUploadSequenceRef = React.useRef(0);

  const internalLabel = t('conversation.internal', 'Internal');
  const resolutionLabel = t('conversation.resolution', 'Resolution');

  const handleAddCommentClick = () => {
    // Auto-check toggles based on which tab is active
    if (!hideInternalTab) {
      setIsInternalToggle(activeTab === internalLabel);
    }
    setIsResolutionToggle(activeTab === resolutionLabel);
    setShowEditor(true);
  };
  const handleSubmitComment = async () => {
    let success = false;
    try {
      if (hideInternalTab) {
        // Client Portal: Call with false for isInternal and use isResolutionToggle for isResolution
        success = await onAddNewComment(false, isResolutionToggle);
        if (success) {
          setIsResolutionToggle(false);
        }
      } else {
        // Main App: Use toggle states for isInternal and isResolution
        const closeStatusId =
          isResolutionToggle && resolutionCloseStatusId !== NO_STATUS_CHANGE
            ? resolutionCloseStatusId
            : null;
        success = await onAddNewComment(isInternalToggle, isResolutionToggle, closeStatusId);
        if (success) {
          setIsInternalToggle(false);
          setIsResolutionToggle(false);
          setResolutionCloseStatusId(NO_STATUS_CHANGE);
        }
      }
      
      if (success) {
        console.log('Comment added successfully, closing editor');
        setDraftClipboardImages([]);
        clipboardUploadSequenceRef.current = 0;
        setShowEditor(false);
      } else {
        console.log('Comment addition failed, keeping editor open');
      }
    } catch (error) {
      console.error('Error during comment submission process:', error);
    }
  };

  const handleCancelComment = () => {
    if (draftClipboardImages.length > 0) {
      setShowDraftCancelDialog(true);
      return;
    }

    setDraftClipboardImages([]);
    clipboardUploadSequenceRef.current = 0;
    onNewCommentContentChange(DEFAULT_BLOCK);
    setShowEditor(false);
  };

  const handleKeepDraftClipboardImages = () => {
    console.info('[TicketConversation] Draft cancel action: keep uploaded clipboard images', {
      ticketId: ticket.ticket_id,
      imageCount: draftClipboardImages.length,
    });
    setShowDraftCancelDialog(false);
    setDraftClipboardImages([]);
    clipboardUploadSequenceRef.current = 0;
    onNewCommentContentChange(DEFAULT_BLOCK);
    setShowEditor(false);
  };

  const handleDeleteDraftClipboardImages = async () => {
    if (!ticket.ticket_id) {
      toast.error('Ticket context is missing for draft image deletion.');
      return;
    }
    if (draftClipboardImages.length === 0) {
      setShowDraftCancelDialog(false);
      setShowEditor(false);
      return;
    }

    setIsDeletingDraftImages(true);
    try {
      const result = await deleteDraftClipboardImages({
        ticketId: ticket.ticket_id,
        documentIds: draftClipboardImages.map((image) => image.documentId),
      });

      const deletedCount = result.deletedDocumentIds.length;
      const failedCount = result.failures.length;

      console.info('[TicketConversation] Draft cancel action: delete uploaded clipboard images', {
        ticketId: ticket.ticket_id,
        requestedCount: draftClipboardImages.length,
        deletedCount,
        failedCount,
        failures: result.failures,
      });

      if (deletedCount > 0) {
        toast.success(`Deleted ${deletedCount} pasted image${deletedCount === 1 ? '' : 's'}.`);
        if (onClipboardImageUploaded) {
          await Promise.resolve(onClipboardImageUploaded());
        }
      }
      if (failedCount > 0) {
        toast.error(`Could not delete ${failedCount} pasted image${failedCount === 1 ? '' : 's'}.`);
      }

      setShowDraftCancelDialog(false);
      setDraftClipboardImages([]);
      clipboardUploadSequenceRef.current = 0;
      onNewCommentContentChange(DEFAULT_BLOCK);
      setShowEditor(false);
    } catch (error) {
      console.error('[TicketConversation] Failed deleting draft clipboard images:', error);
      toast.error('Failed to delete pasted images.');
    } finally {
      setIsDeletingDraftImages(false);
    }
  };

  const uploadClipboardImage = React.useCallback(
    async (file: File, options: { trackDraftImage: boolean }): Promise<string> => {
      const { trackDraftImage } = options;
      if (!ticket.ticket_id) {
        throw new Error('Ticket ID is required for clipboard image upload.');
      }
      if (!currentUser?.id) {
        throw new Error('User session is required for clipboard image upload.');
      }

      const validation = validateClipboardImageFile(file);
      if (!validation.valid) {
        console.warn('[TicketConversation] Clipboard upload rejected by validation', {
          ticketId: ticket.ticket_id,
          userId: currentUser.id,
          mimeType: file.type,
          sizeBytes: file.size,
          reason: validation.error,
        });
        throw new Error(validation.error);
      }

      const sequence = (clipboardUploadSequenceRef.current += 1);
      const timestamp = new Date();
      const renamedFile = renameClipboardImageForUpload({
        file,
        timestamp,
        sequence,
      });

      const formData = new FormData();
      formData.append('file', renamedFile);

      const uploadResult = await uploadDocument(formData, {
        userId: currentUser.id,
        ticketId: ticket.ticket_id,
      });

      if (isActionPermissionError(uploadResult)) {
        const reason = uploadResult.permissionError || 'Clipboard image upload failed.';
        console.error(`[TicketConversation] Clipboard image upload denied: ${reason}`, {
          ticketId: ticket.ticket_id,
          userId: currentUser.id,
          sequence,
          fileName: renamedFile.name,
          mimeType: renamedFile.type,
          sizeBytes: renamedFile.size,
        });
        toast.error(reason);
        throw new Error(reason);
      }

      if (!uploadResult.success) {
        const reason =
          'error' in uploadResult && typeof uploadResult.error === 'string'
            ? uploadResult.error
            : 'Clipboard image upload failed.';
        console.error(`[TicketConversation] Clipboard image upload failed: ${reason}`, {
          ticketId: ticket.ticket_id,
          userId: currentUser.id,
          sequence,
          fileName: renamedFile.name,
          mimeType: renamedFile.type,
          sizeBytes: renamedFile.size,
          error: 'error' in uploadResult ? uploadResult.error : undefined,
        });
        toast.error(reason);
        throw new Error(reason);
      }

      const uploadedDocument = uploadResult.document;
      const fallbackName = createClipboardImageFilename({
        timestamp,
        sequence,
        mimeType: renamedFile.type,
      });
      const viewUrl = uploadedDocument.file_id
        ? `/api/documents/view/${uploadedDocument.file_id}`
        : `/api/documents/download/${uploadedDocument.document_id}`;

      if (trackDraftImage) {
        setDraftClipboardImages((previous) => {
          const exists = previous.some((item) => item.documentId === uploadedDocument.document_id);
          if (exists) return previous;
          return [
            ...previous,
            {
              documentId: uploadedDocument.document_id,
              fileId: uploadedDocument.file_id || '',
              name: uploadedDocument.document_name || fallbackName,
              url: viewUrl,
            },
          ];
        });
      }

      console.info('[TicketConversation] Clipboard image uploaded', {
        ticketId: ticket.ticket_id,
        userId: currentUser.id,
        sequence,
        documentId: uploadedDocument.document_id,
        fileId: uploadedDocument.file_id,
        url: viewUrl,
      });

      if (onClipboardImageUploaded) {
        void Promise.resolve(onClipboardImageUploaded()).catch((refreshError) => {
          console.error('[TicketConversation] Failed to refresh documents after clipboard upload', {
            ticketId: ticket.ticket_id,
            userId: currentUser.id,
            documentId: uploadedDocument.document_id,
            error: refreshError,
          });
        });
      }

      return viewUrl;
    },
    [ticket.ticket_id, currentUser?.id, onClipboardImageUploaded]
  );

  const handleClipboardImageUpload = React.useCallback(
    async (file: File): Promise<string> => {
      return uploadClipboardImage(file, { trackDraftImage: true });
    },
    [uploadClipboardImage]
  );

  const handleClipboardImageUploadForExistingComment = React.useCallback(
    async (file: File): Promise<string> => {
      return uploadClipboardImage(file, { trackDraftImage: false });
    },
    [uploadClipboardImage]
  );

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };
  // Removed renderButtonBar function as it's no longer needed
  const handleAddNewComment = async () => {
    if (hideInternalTab) {
      await onAddNewComment(false, isResolutionToggle);
    } else {
      await onAddNewComment(isInternalToggle, isResolutionToggle);
    }
  };

  // Sync toggles when active tab changes while editor is open
  useEffect(() => {
    if (showEditor) {
      if (!hideInternalTab) {
        setIsInternalToggle(activeTab === internalLabel);
      }
      setIsResolutionToggle(activeTab === resolutionLabel);
    }
  }, [activeTab, showEditor, hideInternalTab, internalLabel, resolutionLabel]);

  // Reset close-status selection when leaving resolution mode or closing the editor.
  useEffect(() => {
    if (!showEditor || !isResolutionToggle) {
      setResolutionCloseStatusId(NO_STATUS_CHANGE);
    }
  }, [showEditor, isResolutionToggle]);

  // Fetch contact avatar URLs for client users
  useEffect(() => {
    const fetchContactAvatarUrls = async () => {
      if (!ticket.tenant) return;
      
      const newContactAvatarUrls: Record<string, string | null> = {};
      const updatedUserMap = { ...userMap };
      
      // Find all client users in the conversations
      for (const conversation of conversations) {
        if (conversation.user_id && userMap[conversation.user_id]?.user_type === 'client') {
          try {
            const contactId = await getUserContactId(conversation.user_id);
            
            if (contactId) {
              const avatarUrl = await getContactAvatarUrlAction(contactId, ticket.tenant);
              if (avatarUrl) {
                newContactAvatarUrls[conversation.user_id] = avatarUrl;
                
                updatedUserMap[conversation.user_id] = {
                  ...userMap[conversation.user_id],
                  avatarUrl: avatarUrl
                };
              }
            }
          } catch (error) {
            console.error(`Error fetching avatar URL for contact ${conversation.user_id}:`, error);
          }
        }
      }
      
      setContactAvatarUrls(newContactAvatarUrls);
      
      Object.keys(updatedUserMap).forEach(key => {
        if (updatedUserMap[key].avatarUrl !== userMap[key].avatarUrl) {
          userMap[key] = updatedUserMap[key];
        }
      });
    };
    
    fetchContactAvatarUrls();
  }, [conversations, ticket.tenant, userMap]);

  // Log when conversations prop changes
  useEffect(() => {
    try {
      if (process.env.NODE_ENV !== 'production') console.log('[TicketConversation] conversations changed', {
        count: conversations.length,
        items: conversations.map(c => ({ id: c.comment_id, updated_at: c.updated_at, noteLen: (c.note || '').length }))
      });
    } catch {}
  }, [conversations]);

  const renderComments = (comments: IComment[]): React.JSX.Element[] => {
    // Use the sorted comments based on the reverseOrder state
    const commentsToRender = reverseOrder ? [...comments].reverse() : comments;
    
    return commentsToRender.map((conversation): React.JSX.Element => {
      const override = overrides[conversation.comment_id || ''];
      const mergedConversation = override
        ? { ...conversation, ...(override.note ? { note: override.note } : {}), ...(override.updated_at ? { updated_at: override.updated_at } : {}) }
        : conversation;
      const itemKey = `${conversation.comment_id}-${conversation.updated_at || ''}-${(conversation.note || '').length}`;
      if (process.env.NODE_ENV !== 'production') console.log('[TicketConversation][renderComments] Rendering', {
        key: itemKey,
        comment_id: mergedConversation.comment_id,
        updated_at: mergedConversation.updated_at,
        noteLen: (mergedConversation.note || '').length,
      });
      return (
      <CommentItem
        key={itemKey}
        id={`${id}-comment-${mergedConversation.comment_id}`}
        conversation={mergedConversation}
        currentUserId={currentUser?.id}
        isEditing={isEditing && currentComment?.comment_id === mergedConversation.comment_id}
        currentComment={currentComment}
        ticketId={ticket.ticket_id || ''}
        userMap={userMap}
        contactMap={contactMap}
        onContentChange={onContentChange}
        onSave={onSave}
        onClose={onClose}
        onEdit={() => onEdit(mergedConversation)}
        onDelete={onDelete}
        hideInternalTab={hideInternalTab}
        uploadFile={handleClipboardImageUploadForExistingComment}
      />
    );
    });
  };

  const renderExternalComments = (): React.JSX.Element | null => {
    if (!externalComments || externalComments.length === 0) {
      return null;
    }

    const commentsToRender = reverseOrder ? [...externalComments].reverse() : externalComments;
    return (
      <div className="mt-4" id={`${compId}-external-comments`}>
        <div className="text-xs text-gray-500 mb-2">
          Inbound replies on child tickets (view-only)
        </div>
        {commentsToRender.map((conversation) => {
          const key = `ext-${conversation.child_ticket_id || 'unknown'}-${conversation.comment_id || conversation.created_at || ''}`;
          return (
            <div key={key} className="mb-2">
              <div className="text-xs text-gray-600 mb-1">
                {conversation.child_client_name ? `${conversation.child_client_name} • ` : ''}
                {conversation.child_ticket_number ? `Ticket ${conversation.child_ticket_number}` : 'Child ticket'}
                {conversation.child_ticket_title ? ` • ${conversation.child_ticket_title}` : ''}
              </div>
              <CommentItem
                key={key}
                id={`${compId}-external-comment-${conversation.comment_id}`}
                conversation={conversation}
                currentUserId={null}
                isEditing={false}
                currentComment={null}
                ticketId={ticket.ticket_id || ''}
                userMap={userMap}
                contactMap={contactMap}
                onContentChange={() => {}}
                onSave={() => {}}
                onClose={() => {}}
                onEdit={() => {}}
                onDelete={() => {}}
                hideInternalTab={hideInternalTab}
              />
            </div>
          );
        })}
      </div>
    );
  };

  // Build tab content array based on hideInternalTab
  const baseTabs = [
    {
      label: t('conversation.allComments', 'All Comments'),
      content: (
        <ReflectionContainer id={`${id}-all-comments`} label="All Comments">
          {renderComments(hideInternalTab
            // For client portal, "All Comments" should exclude internal comments (same as "Client Visible")
            ? conversations.filter(conversation => !conversation.is_internal)
            // For MSP portal, "All Comments" includes all comments
            : conversations)}
        </ReflectionContainer>
      )
    },
    {
      label: t('conversation.client', 'Client'),
      content: (
        <ReflectionContainer id={`${id}-client-visible-comments`} label="Client Comments">
          {renderComments(conversations.filter(conversation => !conversation.is_internal))}
          {renderExternalComments()}
        </ReflectionContainer>
      )
    },
    {
      label: t('conversation.internal', 'Internal'),
      content: (
        <ReflectionContainer id={`${id}-internal-comments`} label="Internal Comments">
          <h3 className="text-lg font-medium mb-4">{t('conversation.internalComments', 'Internal Comments')}</h3>
          {renderComments(conversations.filter(conversation => conversation.is_internal))}
        </ReflectionContainer>
      )
    },
    {
      label: t('conversation.resolution', 'Resolution'),
      content: (
        <ReflectionContainer id={`${id}-resolution-comments`} label="Resolution Comments">
          <h3 className="text-lg font-medium mb-4">{t('conversation.resolutionComments', 'Resolution Comments')}</h3>
          {renderComments(conversations.filter(conversation =>
            conversation.is_resolution && (!hideInternalTab || !conversation.is_internal)
          ))}
        </ReflectionContainer>
      )
    }
  ];

  // Filter and order tabs based on hideInternalTab
  let tabContent;
  if (hideInternalTab) {
    // For client portal, only show "All Comments" (index 0) and "Resolution" (index 3) tabs
    tabContent = [
      baseTabs[0], // All Comments
      baseTabs[3]  // Resolution
    ];
  } else {
    // For MSP portal, show all tabs
    tabContent = baseTabs;
  }

  const tabStyles = {
    trigger: "px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 border-b-2 border-transparent",
    activeTrigger: "data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600"
  };


  return (
    <div {...withDataAutomationId({ id })} className={`${styles['card']}`}>
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{t('conversation.comments', 'Comments')}</h2>
          {!showEditor && (
            <Button
              id={`${compId}-show-comment-editor-btn`}
              onClick={handleAddCommentClick}
            >
              {t('conversation.addComment', 'Add Comment')}
            </Button>
          )}
        </div>
        <div className='mb-3'>
          {showEditor && (
            <div className='flex items-start'>
              <div className="mr-2">
                {/* Use UserAvatar component for current user */}
                <UserAvatar
                  {...withDataAutomationId({ id: `${id}-current-user-avatar` })}
                  userId={currentUser?.id || ''}
                  userName={currentUser?.name || ''}
                  avatarUrl={userMap[currentUser?.id || '']?.avatarUrl || currentUser?.avatarUrl || null}
                  size="md"
                />
              </div>
              <div className='flex-grow'>
                {/* Toggle switches above the editor */}
                <div className="flex flex-wrap items-center gap-4 mb-2 ml-2">
                  {!hideInternalTab && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        id={`${compId}-internal-toggle`}
                        checked={isInternalToggle}
                        onCheckedChange={setIsInternalToggle}
                      />
                      <Label htmlFor={`${id}-internal-toggle`}>
                        {isInternalToggle ? t('conversation.markedAsInternal', 'Marked as Internal') : t('conversation.markAsInternal', 'Mark as Internal')}
                      </Label>
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <Switch
                      id={`${compId}-resolution-toggle`}
                      checked={isResolutionToggle}
                      onCheckedChange={setIsResolutionToggle}
                    />
                    <Label htmlFor={`${id}-resolution-toggle`}>
                      {isResolutionToggle ? t('conversation.markedAsResolution', 'Marked as Resolution') : t('conversation.markAsResolution', 'Mark as Resolution')}
                    </Label>
                  </div>

                  {!hideInternalTab && isResolutionToggle && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`${compId}-resolution-close-status-select`}>
                        {t('tickets.conversation.closeStatus', 'Close status')}
                      </Label>
                      <CustomSelect
                        id={`${compId}-resolution-close-status-select`}
                        value={resolutionCloseStatusId}
                        options={[
                          {
                            value: NO_STATUS_CHANGE,
                            label: t('tickets.conversation.noStatusChange', 'Do not change status'),
                          },
                          ...closedStatusOptions,
                        ]}
                        onValueChange={setResolutionCloseStatusId}
                        className="!w-64"
                        disabled={closedStatusOptions.length === 0}
                      />
                    </div>
                  )}
                </div>
                <Suspense fallback={<RichTextEditorSkeleton height="200px" title="Comment Editor" />}>
                  <TextEditor
                    {...withDataAutomationId({ id: `${compId}-editor` })}
                    key={editorKey}
                    roomName={`ticket-${ticket.ticket_id}`}
                    initialContent={DEFAULT_BLOCK}
                    onContentChange={onNewCommentContentChange}
                    searchMentions={searchUsersForMentions}
                    uploadFile={handleClipboardImageUpload}
                  />
                </Suspense>
                <div className="flex justify-end space-x-2 mt-1">
                  <Button
                    id={`${compId}-add-comment-btn`}
                    onClick={handleSubmitComment}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? tCore('common.loading', 'Loading...') : t('conversation.addComment', 'Add Comment')}
                  </Button>
                  <Button
                    id={`${compId}-cancel-comment-btn`}
                    onClick={handleCancelComment}
                    variant="outline"
                    disabled={isSubmitting}
                  >
                    {tCore('common.cancel', 'Cancel')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        <CustomTabs
          tabs={tabContent}
          defaultTab={t('conversation.allComments', 'All Comments')}
          tabStyles={tabStyles}
          onTabChange={onTabChange}
          extraContent={
            <button
              id={`${compId}-toggle-order-btn`}
              onClick={toggleCommentOrder}
              className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent px-4 py-2 ml-auto"
            >
              <ArrowUpDown className="w-4 h-4" />
              <span>{reverseOrder ? t('conversation.newestFirst', 'Newest first') : t('conversation.oldestFirst', 'Oldest first')}</span>
            </button>
          }
        />
      </div>
      <ConfirmationDialog
        id={`${compId}-clipboard-draft-cancel-dialog`}
        isOpen={showDraftCancelDialog}
        onClose={() => setShowDraftCancelDialog(false)}
        onConfirm={handleDeleteDraftClipboardImages}
        onCancel={handleKeepDraftClipboardImages}
        title={t('conversation.clipboardDraftCancelTitle', 'Pasted Images Detected')}
        message={t(
          'conversation.clipboardDraftCancelMessage',
          'This draft includes pasted images that were already uploaded as ticket documents. Keep them, or delete them permanently?'
        )}
        confirmLabel={t('conversation.deleteUploadedImages', 'Delete Images')}
        thirdButtonLabel={t('conversation.keepUploadedImages', 'Keep Images')}
        cancelLabel={t('common.continueEditing', 'Continue Editing')}
        isConfirming={isDeletingDraftImages}
      />
    </div>
  );
};

export default TicketConversation;
