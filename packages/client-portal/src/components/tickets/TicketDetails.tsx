'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { RichTextViewer } from '@alga-psa/ui/editor';
import { Card } from '@alga-psa/ui/components/Card';
import { TicketDocumentsSection, ResponseSourceBadge, ResponseStateBadge, TicketConversation, TicketAppointmentRequests, type ITicketAppointmentRequest } from '@alga-psa/tickets/components';
import { getLatestCustomerResponseSource } from '@alga-psa/tickets/lib';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  getClientTicketDetails,
  getClientTicketDocuments,
  addClientTicketComment,
  updateClientTicketComment,
  deleteClientTicketComment,
  updateTicketStatus,
  getAppointmentRequestsByTicketId
} from '@alga-psa/client-portal/actions';
import { formatDistanceToNow, format } from 'date-fns';
import { getDateFnsLocale } from '@alga-psa/ui';
import { ITicketWithDetails, TicketResponseState } from '@alga-psa/types';
import { IComment } from '@alga-psa/types';
import { IDocument } from '@alga-psa/types';
import { PartialBlock } from '@blocknote/core';
import { getCurrentUser } from '@alga-psa/users/actions';
import { IStatus } from '@alga-psa/types';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import toast from 'react-hot-toast';

interface TicketDetailsProps {
  ticketId: string;
  isOpen: boolean;
  onClose: () => void;
  asStandalone?: boolean; // When true, renders without Dialog wrapper
  // Pre-fetched data from server component (required)
  initialTicket: ITicketWithDetails;
  initialDocuments: IDocument[];
  initialStatusOptions: IStatus[];
}

export function TicketDetails({
  ticketId,
  isOpen,
  onClose,
  asStandalone = false,
  initialTicket,
  initialDocuments,
  initialStatusOptions
}: TicketDetailsProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  // Use pre-fetched data from server component
  const [ticket, setTicket] = useState<ITicketWithDetails>(initialTicket);
  const [documents, setDocuments] = useState<IDocument[]>(initialDocuments);
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
  const [statusOptions] = useState<IStatus[]>(initialStatusOptions);
  const [ticketToUpdateStatus, setTicketToUpdateStatus] = useState<{ ticketId: string; newStatusId: string; currentStatusName: string; newStatusName: string; } | null>(null);
  const latestCustomerResponseSource = useMemo(
    () => getLatestCustomerResponseSource(ticket.conversations),
    [ticket.conversations]
  );
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
  // No component-level pending state needed; we'll keep optimistic data within the save handler scope

  // State for appointment requests
  const [appointments, setAppointments] = useState<ITicketAppointmentRequest[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);

  // Fetch appointment requests for this ticket
  useEffect(() => {
    const fetchAppointments = async () => {
      if (!ticketId) return;
      // In dialog mode, only load when open
      if (!asStandalone && !isOpen) return;

      setAppointmentsLoading(true);
      try {
        const result = await getAppointmentRequestsByTicketId(ticketId);
        if (result.success && result.data) {
          // Map the data to the expected interface
          const mappedAppointments: ITicketAppointmentRequest[] = result.data.map((appt: any) => ({
            appointment_request_id: appt.appointment_request_id,
            service_name: appt.service_name,
            status: appt.status,
            requested_date: appt.requested_date,
            requested_time: appt.requested_time,
            requested_duration: appt.requested_duration,
            preferred_assigned_user_name: appt.preferred_technician_first_name && appt.preferred_technician_last_name
              ? `${appt.preferred_technician_first_name} ${appt.preferred_technician_last_name}`
              : undefined,
            approved_at: appt.approved_at,
            approver_first_name: appt.approver_first_name,
            approver_last_name: appt.approver_last_name,
            declined_reason: appt.declined_reason,
            is_authenticated: appt.is_authenticated
          }));
          setAppointments(mappedAppointments);
        }
      } catch (err) {
        console.error('Failed to fetch appointment requests:', err);
      } finally {
        setAppointmentsLoading(false);
      }
    };

    fetchAppointments();
  }, [ticketId, isOpen, asStandalone]);

  // Fetch current user on mount (for comment authorship)
  useEffect(() => {
    const fetchCurrentUser = async () => {
      // In dialog mode, only load when open
      if (!asStandalone && !isOpen) {
        return;
      }

      try {
        const user = await getCurrentUser();
        if (user) {
          setCurrentUser({
            id: user.user_id,
            name: `${user.first_name} ${user.last_name}`,
            email: user.email,
            avatarUrl: user.avatarUrl
          });
        }
      } catch (err) {
        console.error('Failed to get current user:', err);
      }
    };

    fetchCurrentUser();
  }, [isOpen, asStandalone]);

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
        return { ...prev, conversations: updatedConversations } as ITicketWithDetails;
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
      const detailsWithExtras = details as ITicketWithDetails;
      const fetchedConv = (detailsWithExtras.conversations || []).find(c => c.comment_id === optimisticCommentId);
      if (process.env.NODE_ENV !== 'production') console.log('[ClientPortal][handleSave] Refetch result for edited comment', {
        comment_id: optimisticCommentId,
        fetchedUpdatedAt: fetchedConv?.updated_at,
        fetchedNoteLen: (fetchedConv?.note || '').length,
      });
      // Merge: prefer our optimistic update if it’s newer than fetched data
      setTicket(() => {
        const merged = { ...detailsWithExtras } as ITicketWithDetails;
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

      setTicket(prevTicket => ({ ...prevTicket, status_id: newStatusId, status_name: newStatusName }));

    } catch (error) {
      console.error('Failed to update ticket status:', error);
      toast.error(t('tickets.messages.statusUpdateError', 'Failed to update ticket status.'));
    } finally {
      setTicketToUpdateStatus(null);
    }
  };

  const ticketContent = (
    <>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {ticket && (
        <div className="space-y-4">
          {/* Header with number and dates */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <span className="text-xs text-gray-500">#{ticket.ticket_number}</span>
            </div>
            <div className="text-right text-xs text-gray-500 ml-4">
              <div className="whitespace-nowrap">
                {t('tickets.fields.created', 'Created')} {format(new Date(ticket.entered_at || ''), 'MMM d, yyyy h:mm a', { locale: dateLocale })} ({formatDistanceToNow(new Date(ticket.entered_at || ''), { addSuffix: true, locale: dateLocale })})
              </div>
              {ticket.updated_at && (
                <div className="whitespace-nowrap">
                  {t('tickets.fields.lastUpdated', 'Last Updated')} {format(new Date(ticket.updated_at), 'MMM d, yyyy h:mm a', { locale: dateLocale })} ({formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true, locale: dateLocale })})
                </div>
              )}
            </div>
          </div>

          {/* Ticket Details Section */}
          <div className="bg-white border border-gray-200 rounded-3xl p-6 space-y-5">
            {/* Title */}
            <div>
              <div className="text-2xl font-semibold text-gray-900">
                {ticket.title || t('tickets.messages.noTitle', 'No title')}
              </div>
            </div>

            {/* Status */}
            <div>
              <label className="font-bold text-gray-900 block mb-2">
                {t('tickets.fields.status', 'Status')}
              </label>
              <div className="flex items-center gap-3">
                <CustomSelect
                  value={ticket.status_id || ''}
                  options={statusOptions.map((status) => ({
                    value: status.status_id || '',
                    label: status.name || ''
                  }))}
                  onValueChange={(value) => {
                    if (ticket.status_id !== value) {
                      const selectedStatus = statusOptions.find(s => s.status_id === value);
                      if (selectedStatus) {
                        setTicketToUpdateStatus({
                          ticketId: ticket.ticket_id!,
                          newStatusId: selectedStatus.status_id!,
                          currentStatusName: ticket.status_name || '',
                          newStatusName: selectedStatus.name || ''
                        });
                      }
                    }
                  }}
                  className="!w-fit"
                />
                {/* Response State Badge - client-friendly wording (F026-F030) */}
                {(ticket as any).response_state && (
                  <ResponseStateBadge
                    responseState={(ticket as any).response_state as TicketResponseState}
                    isClientPortal={true}
                    size="md"
                    labels={{
                      awaitingClient: t('tickets.responseState.awaitingYourResponse', 'Awaiting Your Response'),
                      awaitingInternal: t('tickets.responseState.awaitingSupportResponse', 'Awaiting Support Response'),
                      awaitingClientTooltip: t('tickets.responseState.awaitingYourResponseTooltip', 'Support is waiting for your response'),
                      awaitingInternalTooltip: t('tickets.responseState.awaitingSupportResponseTooltip', 'Your response has been received. Support will respond soon.'),
                    }}
                  />
                )}
                {latestCustomerResponseSource && (
                  <ResponseSourceBadge
                    source={latestCustomerResponseSource}
                    size="md"
                    labels={{
                      clientPortal: t('tickets.responseSource.clientPortal', 'Received via Client Portal'),
                      inboundEmail: t('tickets.responseSource.inboundEmail', 'Received via Inbound Email'),
                    }}
                  />
                )}
              </div>
            </div>

            {/* Assigned To */}
            <div>
              <label className="font-bold text-gray-900 block mb-2">
                {t('tickets.fields.assignedTo', 'Assigned To')}
              </label>
              <div className="flex items-center gap-2">
                {ticket.assigned_to && ticket.userMap?.[ticket.assigned_to] ? (
                  <>
                    <UserAvatar
                      userId={ticket.userMap[ticket.assigned_to].user_id}
                      userName={`${ticket.userMap[ticket.assigned_to].first_name} ${ticket.userMap[ticket.assigned_to].last_name}`}
                      avatarUrl={ticket.userMap[ticket.assigned_to].avatarUrl || null}
                      size="sm"
                    />
                    <span className="text-sm text-gray-900">
                      {ticket.userMap[ticket.assigned_to].first_name} {ticket.userMap[ticket.assigned_to].last_name}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-500">-</span>
                )}
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="font-bold text-gray-900 block mb-2">
                {t('tickets.fields.priority', 'Priority')}
              </label>
              <div className="inline-flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full border border-gray-300 ${!ticket.priority_color ? 'bg-gray-500' : ''}`}
                  style={ticket.priority_color ? { backgroundColor: ticket.priority_color } : undefined}
                />
                <span className="text-sm text-gray-700">
                  {ticket.priority_name || t('tickets.priority.unknown', 'Unknown Priority')}
                </span>
              </div>
            </div>

            {/* Due Date */}
            <div>
              <label className="font-bold text-gray-900 block mb-2">
                {t('tickets.fields.dueDate', 'Due Date')}
              </label>
              {ticket.due_date ? (() => {
                const dueDate = new Date(ticket.due_date);
                const now = new Date();
                const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

                // Check if time is midnight (00:00) - show date only
                const isMidnight = dueDate.getHours() === 0 && dueDate.getMinutes() === 0;
                const displayFormat = isMidnight ? 'MMM d, yyyy' : 'MMM d, yyyy h:mm a';

                // Determine styling based on due date status
                let textColorClass = 'text-gray-700';
                let bgColorClass = '';

                if (hoursUntilDue < 0) {
                  textColorClass = 'text-red-700';
                  bgColorClass = 'bg-red-50';
                } else if (hoursUntilDue <= 24) {
                  textColorClass = 'text-orange-700';
                  bgColorClass = 'bg-orange-50';
                }

                return (
                  <span className={`text-sm inline-block ${textColorClass} ${bgColorClass ? `${bgColorClass} px-2 py-0.5 rounded-full` : ''}`}>
                    {format(dueDate, displayFormat)}
                  </span>
                );
              })() : (
                <span className="text-sm text-gray-500">-</span>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="font-bold text-gray-900 block mb-2">
                {t('tickets.fields.description', 'Description')}
              </label>
              <div className="flex-1">
                <div className="font-bold text-gray-700 break-words">
                  {ticket.attributes?.description ? (
                    <RichTextViewer
                      content={(() => {
                        // JSONB columns are already parsed by PostgreSQL - no need for JSON.parse
                        const description = ticket.attributes?.description;
                        if (Array.isArray(description) && description.length > 0) {
                          // Valid BlockNote content
                          return description;
                        }
                        // Fallback to default empty block if invalid
                        return [{
                          type: "paragraph",
                          props: {
                            textAlignment: "left",
                            backgroundColor: "default",
                            textColor: "default"
                          },
                          content: [{
                            type: "text",
                            text: (ticket.attributes?.description as string) || "",
                            styles: {}
                          }]
                        }];
                      })()}
                      className="break-words max-w-full"
                    />
                  ) : (
                    t('tickets.messages.noDescription', 'No description found.')
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Comments Section */}
          {ticket.conversations && (
            <div>
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
            </div>
          )}

          {/* Documents Section */}
          {ticket.ticket_id && (
            <div>
              <Card>
                <TicketDocumentsSection
                  ticketId={ticket.ticket_id}
                  initialDocuments={documents}
                  onDocumentCreated={async () => {
                    // Refresh documents after creation
                    const docs = await getClientTicketDocuments(ticketId);
                    setDocuments(docs);
                  }}
                />
              </Card>
            </div>
          )}

          {/* Appointment Requests Section */}
          {ticket.ticket_id && (
            <div>
              <TicketAppointmentRequests
                ticketId={ticket.ticket_id}
                appointments={appointments}
                isLoading={appointmentsLoading}
              />
            </div>
          )}
        </div>
      )}
    </>
  );

  // Render standalone or in dialog based on asStandalone prop
  if (asStandalone) {
    return (
      <>
        <div className="w-full max-w-5xl mx-auto p-2">
          {ticketContent}
        </div>

        {/* Confirmation Dialog for Status Change */}
        <ConfirmationDialog
          isOpen={!!ticketToUpdateStatus}
          onClose={() => setTicketToUpdateStatus(null)}
          onConfirm={handleStatusChangeConfirm}
          title={t('tickets.actions.changeStatus', 'Change Status')}
          message={t('tickets.actions.confirmStatusChange', 'Are you sure you want to change the status of this ticket?')}
          confirmLabel={t('common.update', 'Update')}
          cancelLabel={t('common.cancel', 'Cancel')}
        />
      </>
    );
  }

  // Default: render in dialog
  return (
    <>
      <Dialog isOpen={isOpen} onClose={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {ticketContent}
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Status Change */}
      <ConfirmationDialog
        isOpen={!!ticketToUpdateStatus}
        onClose={() => setTicketToUpdateStatus(null)}
        onConfirm={handleStatusChangeConfirm}
        title={t('tickets.actions.changeStatus', 'Change Status')}
        message={t('tickets.actions.confirmStatusChange', 'Are you sure you want to change the status of this ticket?')}
        confirmLabel={t('common.update', 'Update')}
        cancelLabel={t('common.cancel', 'Cancel')}
      />
    </>
  );
}
