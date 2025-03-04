'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import { X } from 'lucide-react';
import { extractTextFromBlocks } from 'server/src/lib/utils/textUtils';
import { 
  getClientTicketDetails, 
  addClientTicketComment,
  updateClientTicketComment,
  deleteClientTicketComment
} from 'server/src/lib/actions/client-portal-actions/client-tickets';
import { formatDistanceToNow } from 'date-fns';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';
import { IComment } from 'server/src/interfaces/comment.interface';
import { IDocument } from 'server/src/interfaces/document.interface';
import TicketConversation from 'server/src/components/tickets/TicketConversation';
import { DEFAULT_BLOCK } from 'server/src/components/editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

interface TicketDetailsProps {
  ticketId: string;
  open: boolean;
  onClose: () => void;
}

interface TicketWithDetails extends ITicket {
  status_name?: string;
  priority_name?: string;
  conversations?: IComment[];
  documents?: IDocument[];
  userMap?: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; }>;
}

export function TicketDetails({ ticketId, open, onClose }: TicketDetailsProps) {
  const [ticket, setTicket] = useState<TicketWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; name?: string | null; email?: string | null; } | null>(null);
  const [activeTab, setActiveTab] = useState('Comments');
  const [isEditing, setIsEditing] = useState(false);
  const [currentComment, setCurrentComment] = useState<IComment | null>(null);
  const [editorKey, setEditorKey] = useState(0);
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

  useEffect(() => {
    const loadTicketDetails = async () => {
      if (!open) return;
      
      setLoading(true);
      setError(null);
      try {
        const [details, user] = await Promise.all([
          getClientTicketDetails(ticketId),
          getCurrentUser()
        ]);
        setTicket(details);
        if (user) {
          setCurrentUser({
            id: user.user_id,
            name: `${user.first_name} ${user.last_name}`,
            email: user.email
          });
        }
      } catch (err) {
        setError('Failed to load ticket details');
        console.error(err);
      }
      setLoading(false);
    };

    loadTicketDetails();
  }, [ticketId, open]);

  const handleNewCommentContentChange = (content: PartialBlock[]) => {
    setNewCommentContent(content);
  };

  const handleAddNewComment = async () => {
    try {
      await addClientTicketComment(ticketId, JSON.stringify(newCommentContent));
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
    } catch (error) {
      console.error('Failed to add comment:', error);
      setError('Failed to add comment');
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
      
      await updateClientTicketComment(currentComment.comment_id, updates);
      setIsEditing(false);
      setCurrentComment(null);
      
      // Refresh ticket details to get updated comment
      const details = await getClientTicketDetails(ticketId);
      setTicket(details);
    } catch (error) {
      console.error('Failed to update comment:', error);
      setError('Failed to update comment');
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
        setError('You can only delete your own comments');
        return;
      }
      
      await deleteClientTicketComment(comment.comment_id);
      // Refresh ticket details to remove deleted comment
      const details = await getClientTicketDetails(ticketId);
      setTicket(details);
    } catch (error) {
      console.error('Failed to delete comment:', error);
      setError('Failed to delete comment');
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

  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[800px] max-h-[80vh] overflow-y-auto animate-scale-in">
          <Dialog.Title className="text-xl font-bold mb-4">
            {loading ? 'Loading...' : ticket?.title}
          </Dialog.Title>

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
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {ticket.status_name || 'Unknown Status'}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {ticket.priority_name || 'Unknown Priority'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    Ticket #{ticket.ticket_number}
                  </p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <p>Created {formatDistanceToNow(new Date(ticket.entered_at || ''), { addSuffix: true })}</p>
                  {ticket.updated_at && (
                    <p>Updated {formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true })}</p>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Description</h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {extractTextFromBlocks((ticket.attributes?.description as string) || '')}
                </p>
              </div>

              {ticket.conversations && (
                <TicketConversation
                  ticket={ticket}
                  conversations={ticket.conversations}
                  documents={ticket.documents || []}
                  userMap={ticket.userMap || {}}
                  currentUser={currentUser}
                  activeTab={activeTab === 'Internal' ? 'Comments' : activeTab}
                  hideInternalTab={true}
                  isEditing={isEditing}
                  currentComment={currentComment}
                  editorKey={editorKey}
                  onNewCommentContentChange={handleNewCommentContentChange}
                  onAddNewComment={handleAddNewComment}
                  // Override tab change to prevent 'Internal' tab selection
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
                />
              )}
            </div>
          )}

          <Dialog.Close>
            <Button
              id="close-ticket-details-button"
              variant="ghost"
              size="sm"
              className="absolute top-4 right-4 p-0 w-6 h-6 flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
