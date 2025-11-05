'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { ChevronDown } from 'lucide-react';
import RichTextViewer from 'server/src/components/editor/RichTextViewer';
import { Card } from 'server/src/components/ui/Card';
import TicketDocumentsSection from 'server/src/components/tickets/ticket/TicketDocumentsSection';
import { 
  getClientTicketDetails, 
  addClientTicketComment,
  updateClientTicketComment,
  deleteClientTicketComment,
  updateTicketStatus
} from 'server/src/lib/actions/client-portal-actions/client-tickets';
import { formatDistanceToNow } from 'date-fns';
import { getDateFnsLocale } from 'server/src/lib/utils/dateFnsLocale';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';
import { IComment } from 'server/src/interfaces/comment.interface';
import { IDocument } from 'server/src/interfaces/document.interface';
import TicketConversation from 'server/src/components/tickets/ticket/TicketConversation';
import { DEFAULT_BLOCK } from 'server/src/components/editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getTicketStatuses } from 'server/src/lib/actions/status-actions/statusActions';
import { IStatus } from 'server/src/interfaces/status.interface';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import toast from 'react-hot-toast';

interface TicketDetailsProps {
  ticketId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface TicketWithDetails extends ITicket {
  status_name?: string;
  priority_name?: string;
  priority_color?: string;
  conversations?: IComment[];
  documents?: IDocument[];
  userMap?: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; avatarUrl: string | null }>;
}

export function TicketDetails({ ticketId, isOpen, onClose }: TicketDetailsProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [ticket, setTicket] = useState<TicketWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null>(null);
  const [activeTab, setActiveTab] = useState(t('tickets.messages.comments', 'Comments'));
  const [isEditing, setIsEditing] = useState(false);
  const [currentComment, setCurrentComment] = useState<IComment | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  // Force remount of TicketConversation when needed
  const [conversationVersion, setConversationVersion] = useState(0);
  // Local overrides for comments to ensure immediate UI reflection
  const [commentOverrides, setCommentOverrides] = useState<Record<string, { note?: string; updated_at?: string }>>({});
  const [statusOptions, setStatusOptions] = useState<IStatus[]>([]);
  const [ticketToUpdateStatus, setTicketToUpdateStatus] = useState<{ ticketId: string; newStatusId: string; currentStatusName: string; newStatusName: string; } | null>(null);
  const [newCommentContent, setNewCommentContent] = useState<PartialBlock[]>([{ 
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
  }]);
  // No component-level pending state needed; we’ll keep optimistic data within the save handler scope

  useEffect(() => {
    const loadTicketDetails = async () => {
      if (!isOpen) {
        // Don't load when dialog is closed, but preserve existing data for close animation
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [details, user, statuses] = await Promise.all([
          getClientTicketDetails(ticketId),
          getCurrentUser(),
          getTicketStatuses()
        ]);
        setTicket(details);
        setStatusOptions(statuses || []);
        if (user) {
          setCurrentUser({
            id: user.user_id,
            name: `${user.first_name} ${user.last_name}`,
            email: user.email,
            avatarUrl: user.avatarUrl // Include avatarUrl from the fetched user object
          });
        }
        setLoading(false);
      } catch (err) {
        setError(t('tickets.messages.loadError', 'Failed to load ticket details'));
        console.error(err);
        setLoading(false);
      }
    };

    loadTicketDetails();
  }, [ticketId, isOpen, t]);

  const handleNewCommentContentChange = (content: PartialBlock[]) => {
    setNewCommentContent(content);
  };
  const handleAddNewComment = async (isInternal: boolean, isResolution: boolean): Promise<boolean> => {
    const contentStr = JSON.stringify(newCommentContent);
    const hasContent = contentStr !== JSON.stringify([{
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
    }]);

    if (!hasContent) {
      console.log("Cannot add empty comment");
      toast.error(t('tickets.messages.emptyComment', 'Cannot add empty comment'));
      return false;
    }

    try {
      await addClientTicketComment(
        ticketId,
        JSON.stringify(newCommentContent),
        isInternal,
        isResolution
      );
      // Reset editor
      setEditorKey(prev => prev + 1);
      setNewCommentContent([{
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
      }]);
      // Refresh ticket details to get new comment
      const details = await getClientTicketDetails(ticketId);
      setTicket(details);
      return true;
    } catch (error) {
      console.error('Failed to add comment:', error);
      setError(t('tickets.messages.commentError', 'Failed to add comment'));
      toast.error(t('tickets.messages.commentError', 'Failed to add comment'));
      return false;
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  const handleEdit = (comment: IComment) => {
    setCurrentComment(comment);
    setIsEditing(true);
  };

  const handleSave = async (updates: Partial<IComment>) => {
    try {
      if (!currentComment?.comment_id) return;
      
      if (updates.note) {
        try {
          const parsedContent = JSON.parse(updates.note);
          const isEmpty = 
            (Array.isArray(parsedContent) && parsedContent.length === 0) ||
            (Array.isArray(parsedContent) && parsedContent.length === 1 && 
             parsedContent[0].type === 'paragraph' && 
             (!parsedContent[0].content || 
              (Array.isArray(parsedContent[0].content) && parsedContent[0].content.length === 0) ||
              (Array.isArray(parsedContent[0].content) && parsedContent[0].content.length === 1 && 
               parsedContent[0].content[0].text === '')));
          
          if (isEmpty) {
            toast.error(t('tickets.messages.emptyNote', 'Cannot save empty note'));
            return;
          }
        } catch (e) {
          console.error("Error parsing note JSON:", e);
        }
      }
      
      if (process.env.NODE_ENV !== 'production') console.log('[ClientPortal][handleSave] Attempting save', {
        comment_id: currentComment.comment_id,
        hasNote: !!updates.note,
        noteLen: updates.note ? updates.note.length : 0,
      });
      await updateClientTicketComment(currentComment.comment_id, updates);
      if (process.env.NODE_ENV !== 'production') console.log('[ClientPortal][handleSave] Save succeeded');

      // Prepare an optimistic version of the updated comment for immediate UI update and later merge
      const optimisticUpdatedAt = new Date().toISOString();
      const optimisticCommentId = currentComment.comment_id;
      const optimisticNote = updates.note;

      // Optimistically update the local ticket state so the UI reflects changes immediately
      setTicket(prev => {
        if (!prev) return prev;
        const updatedConversations = (prev.conversations || []).map(conv => {
          if (conv.comment_id === optimisticCommentId) {
            if (process.env.NODE_ENV !== 'production') console.log('[ClientPortal][optimistic] Updating local state', {
              comment_id: conv.comment_id,
              prevUpdatedAt: conv.updated_at,
              nextUpdatedAt: optimisticUpdatedAt,
              prevNoteLen: (conv.note || '').length,
              nextNoteLen: (updates.note || conv.note || '').length,
            });
            return {
              ...conv,
              ...updates,
              updated_at: optimisticUpdatedAt,
            } as IComment;
          }
          return conv;
        });
        return { ...prev, conversations: updatedConversations } as TicketWithDetails;
      });

      // Set override to guarantee immediate child render with latest note
      setCommentOverrides(prev => ({
        ...prev,
        [optimisticCommentId]: { note: optimisticNote, updated_at: optimisticUpdatedAt }
      }));

      // Force remount of the conversation list to avoid any stale subtrees
      setConversationVersion(v => v + 1);
      setIsEditing(false);
      setCurrentComment(null);

      // Refresh ticket details to get the authoritative updated comment
      if (process.env.NODE_ENV !== 'production') console.log('[ClientPortal][handleSave] Refetching ticket details');
      const details = await getClientTicketDetails(ticketId);
      const detailsWithExtras = details as TicketWithDetails;
      const fetchedConv = (detailsWithExtras.conversations || []).find(c => c.comment_id === optimisticCommentId);
      if (process.env.NODE_ENV !== 'production') console.log('[ClientPortal][handleSave] Refetch result for edited comment', {
        comment_id: optimisticCommentId,
        fetchedUpdatedAt: fetchedConv?.updated_at,
        fetchedNoteLen: (fetchedConv?.note || '').length,
      });
      // Merge: prefer our optimistic update if it’s newer than fetched data
      setTicket(() => {
        const merged = { ...detailsWithExtras } as TicketWithDetails;
        merged.conversations = (detailsWithExtras.conversations || []).map(conv => {
          if (conv.comment_id === optimisticCommentId) {
            const fetchedTime = conv.updated_at ? new Date(conv.updated_at).getTime() : 0;
            const optimisticTime = new Date(optimisticUpdatedAt).getTime();
            if (optimisticTime > fetchedTime) {
              if (process.env.NODE_ENV !== 'production') console.log('[ClientPortal][merge] Keeping optimistic version', {
                optimisticUpdatedAt,
                fetchedUpdatedAt: conv.updated_at,
                fetchedNoteLen: (conv.note || '').length,
                optimisticNoteLen: (optimisticNote || '').length,
              });
              return {
                ...conv,
                note: optimisticNote ?? conv.note,
                updated_at: optimisticUpdatedAt,
              } as IComment;
            } else {
              if (process.env.NODE_ENV !== 'production') console.log('[ClientPortal][merge] Keeping fetched version', {
                optimisticUpdatedAt,
                fetchedUpdatedAt: conv.updated_at,
              });
            }
          }
          return conv;
        });
        return merged;
      });

      // Clear override after refetch resolution
      setCommentOverrides(prev => {
        const next = { ...prev };
        delete next[optimisticCommentId];
        return next;
      });
    } catch (error) {
      console.error('Failed to update comment:', error);
      setError(t('tickets.messages.failedToUpdateComment', 'Failed to update comment'));
      toast.error(t('tickets.messages.failedToUpdateComment', 'Failed to update comment'));
    }
  };

  const handleClose = () => {
    setIsEditing(false);
    setCurrentComment(null);
  };

  const handleDelete = async (comment: IComment) => {
    try {
      if (!comment.comment_id) return;
      
      // Check if the comment belongs to the current user
      if (comment.user_id !== currentUser?.id) {
        setError(t('tickets.messages.deleteOwnCommentError', 'You can only delete your own comments'));
        toast.error(t('tickets.messages.deleteOwnCommentError', 'You can only delete your own comments'));
        return;
      }
      
      await deleteClientTicketComment(comment.comment_id);
      // Refresh ticket details to remove deleted comment
      const details = await getClientTicketDetails(ticketId);
      setTicket(details);
      toast.success(t('tickets.messages.commentDeleteSuccess', 'Comment deleted successfully'));
    } catch (error) {
      console.error('Failed to delete comment:', error);
      setError(t('tickets.messages.failedToDeleteComment', 'Failed to delete comment'));
      toast.error(t('tickets.messages.failedToDeleteComment', 'Failed to delete comment'));
    }
  };

  const handleContentChange = (content: PartialBlock[]) => {
    if (currentComment) {
      setCurrentComment({
        ...currentComment,
        note: JSON.stringify(content)
      });
    }
  };

  const handleStatusChangeConfirm = async () => {
    if (!ticketToUpdateStatus || !ticket) return;

    const { ticketId, newStatusId, newStatusName } = ticketToUpdateStatus;

    try {
      await updateTicketStatus(ticketId, newStatusId);
      toast.success(t('tickets.messages.statusUpdateSuccess', 'Ticket status successfully updated to "{{status}}".', { status: newStatusName }));

      setTicket(prevTicket => prevTicket ? { ...prevTicket, status_id: newStatusId, status_name: newStatusName } : null);

    } catch (error) {
      console.error('Failed to update ticket status:', error);
      toast.error(t('tickets.messages.statusUpdateError', 'Failed to update ticket status.'));
    } finally {
      setTicketToUpdateStatus(null);
    }
  };

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title={ticket?.title || (loading ? t('common.loading') : '')}
        className="max-w-[800px] max-h-[80vh] overflow-y-auto"
        id="ticket-details"
      >
        <DialogContent>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {!loading && ticket && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 cursor-pointer hover:bg-blue-200">
                          {ticket.status_name || t('tickets.status.unknown', 'Unknown Status')}
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </span>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content className="w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                        {statusOptions
                          .map((status) => (
                            <DropdownMenu.Item
                              key={status.status_id}
                              className="px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer outline-none"
                              onSelect={() => {
                                if (ticket.status_id !== status.status_id) {
                                  setTicketToUpdateStatus({
                                    ticketId: ticket.ticket_id!,
                                    newStatusId: status.status_id!,
                                    currentStatusName: ticket.status_name || '',
                                    newStatusName: status.name || ''
                                  });
                                }
                              }}
                            >
                              {status.name}
                            </DropdownMenu.Item>
                          ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      <div className="flex items-center gap-2">
                        <div 
                          className={`w-3 h-3 rounded-full border border-gray-300 ${!ticket.priority_color ? 'bg-gray-500' : ''}`}
                          style={ticket.priority_color ? { backgroundColor: ticket.priority_color } : undefined}
                        />
                        <span>{ticket.priority_name || t('tickets.priority.unknown', 'Unknown Priority')}</span>
                      </div>
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {t('tickets.fields.ticketNumber')} #{ticket.ticket_number}
                  </p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <p>{t('tickets.fields.createdAt')} {formatDistanceToNow(new Date(ticket.entered_at || ''), { addSuffix: true, locale: dateLocale })}</p>
                  {ticket.updated_at && (
                    <p>{t('tickets.fields.updatedAt')} {formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true, locale: dateLocale })}</p>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-2">{t('tickets.fields.description')}</h3>
                <div className="text-sm text-gray-700 break-words max-w-full overflow-hidden">
                  {(ticket.attributes?.description as string) ? (
                    <RichTextViewer
                      content={(() => {
                        try {
                          const parsed = JSON.parse(ticket.attributes?.description as string);
                          if (Array.isArray(parsed)) {
                            return parsed;
                          }
                        } catch {
                          return ticket.attributes?.description as string;
                        }
                        return ticket.attributes?.description as string;
                      })()}
                      className="break-words max-w-full"
                    />
                  ) : (
                    t('tickets.messages.noDescription', 'No description found.')
                  )}
                </div>
              </div>

              {ticket.conversations && (
                <TicketConversation
                  key={`conv-${conversationVersion}`}
                  ticket={ticket}
                  conversations={ticket.conversations}
                  documents={ticket.documents || []}
                  userMap={ticket.userMap || {}}
                  currentUser={currentUser}
                  activeTab={activeTab === 'Internal' ? t('tickets.messages.comments', 'Comments') : activeTab}
                  hideInternalTab={true}
                  isEditing={isEditing}
                  currentComment={currentComment}
                  editorKey={editorKey}
                  onNewCommentContentChange={handleNewCommentContentChange}
                  onAddNewComment={handleAddNewComment}
                  onTabChange={(tab) => {
                    if (tab !== 'Internal') {
                      setActiveTab(tab);
                    }
                  }}
                  onEdit={handleEdit}
                  onSave={handleSave}
                  onClose={handleClose}
                  onDelete={handleDelete}
                  onContentChange={handleContentChange}
                  overrides={commentOverrides}
                />
              )}
              
              {ticket.ticket_id && (
                <Card className="mt-6">
                  <TicketDocumentsSection ticketId={ticket.ticket_id} />
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Confirmation Dialog for Status Change */}
      <ConfirmationDialog
        isOpen={!!ticketToUpdateStatus}
        onClose={() => setTicketToUpdateStatus(null)}
        onConfirm={handleStatusChangeConfirm}
        title={t('tickets.actions.changeStatus')}
        message={t('tickets.actions.confirmStatusChange')}
        confirmLabel="Update"
        cancelLabel="Cancel"
      />
    </>
  );
}
