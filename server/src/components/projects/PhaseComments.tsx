'use client';

import React, { useState, useRef } from 'react';
import { ArrowUpDown, Edit2, Trash2, MessageSquare, Bold, Italic, Link, Code, List, ListOrdered, Quote, Paperclip, Smile, MoreHorizontal, Eye } from 'lucide-react';
import { IProjectPhaseComment } from 'server/src/interfaces';
import { Button } from 'server/src/components/ui/Button';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { TextArea } from 'server/src/components/ui/TextArea';

interface PhaseCommentsProps {
  phaseId: string;
  comments: IProjectPhaseComment[];
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; avatarUrl: string | null }>;
  currentUser: { id: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null | undefined;
  onAddComment: (content: string) => Promise<boolean>;
  onEditComment: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  isSubmitting?: boolean;
  className?: string;
  isCreateMode?: boolean;
}

const PhaseComments: React.FC<PhaseCommentsProps> = ({
  phaseId,
  comments,
  userMap,
  currentUser,
  onAddComment,
  onEditComment,
  onDeleteComment,
  isSubmitting = false,
  className = "",
  isCreateMode = false
}) => {
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(true);
  const [newCommentContent, setNewCommentContent] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showEditPreview, setShowEditPreview] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const editTextAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleAddCommentClick = () => {
    setShowEditor(true);
  };

  const handleSubmitComment = async () => {
    if (!newCommentContent.trim()) return;

    try {
      const success = await onAddComment(newCommentContent);

      if (success) {
        setShowEditor(false);
        setNewCommentContent('');
      }
    } catch (error) {
      console.error('Error during comment submission process:', error);
    }
  };

  const handleCancelComment = () => {
    setShowEditor(false);
    setNewCommentContent('');
  };

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };

  const handleEdit = (comment: IProjectPhaseComment) => {
    setEditingCommentId(comment.project_phase_comment_id!);
    setEditContent(comment.note);
  };

  const handleSaveEdit = async () => {
    if (editingCommentId && editContent.trim()) {
      await onEditComment(editingCommentId, editContent);
      setEditingCommentId(null);
      setEditContent('');
      setShowEditPreview(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditContent('');
    setShowEditPreview(false);
  };

  // Rich text formatting functions
  const insertFormatting = (format: string, ref: React.RefObject<HTMLTextAreaElement>, content: string, setContent: (content: string) => void) => {
    if (!ref.current) return;

    const textarea = ref.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);

    let newText = '';
    let newCursorPos = start;

    switch (format) {
      case 'bold':
        newText = `**${selectedText || 'bold text'}**`;
        newCursorPos = selectedText ? end + 4 : start + 2;
        break;
      case 'italic':
        newText = `*${selectedText || 'italic text'}*`;
        newCursorPos = selectedText ? end + 2 : start + 1;
        break;
      case 'code':
        newText = `\`${selectedText || 'code'}\``;
        newCursorPos = selectedText ? end + 2 : start + 1;
        break;
      case 'link':
        newText = `[${selectedText || 'link text'}](url)`;
        newCursorPos = selectedText ? end + 7 : start + 11;
        break;
      case 'bullet':
        newText = `\n* ${selectedText || 'list item'}`;
        newCursorPos = selectedText ? end + 3 : start + 3;
        break;
      case 'numbered':
        newText = `\n1. ${selectedText || 'list item'}`;
        newCursorPos = selectedText ? end + 4 : start + 4;
        break;
      case 'quote':
        newText = `\n> ${selectedText || 'quote'}`;
        newCursorPos = selectedText ? end + 3 : start + 3;
        break;
      default:
        return;
    }

    const newContent = content.substring(0, start) + newText + content.substring(end);
    setContent(newContent);

    // Set cursor position after state update
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const renderFormattedText = (text: string) => {
    // Simple markdown-like rendering for preview
    let formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 rounded">$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 hover:underline">$1</a>')
      .replace(/^> (.*)/gm, '<blockquote class="border-l-4 border-gray-300 pl-3 text-gray-600 italic">$1</blockquote>')
      .replace(/^\* (.*)/gm, '<li class="ml-4">$1</li>')
      .replace(/^\d+\. (.*)/gm, '<li class="ml-4">$1</li>')
      .replace(/\n/g, '<br>');

    return <div dangerouslySetInnerHTML={{ __html: formatted }} />;
  };

  const handleDelete = async (comment: IProjectPhaseComment) => {
    if (comment.project_phase_comment_id) {
      await onDeleteComment(comment.project_phase_comment_id);
    }
  };

  const getAuthorInfo = (comment: IProjectPhaseComment) => {
    if (comment.user_id) {
      // First check if we have the user in the userMap
      if (userMap[comment.user_id]) {
        return userMap[comment.user_id];
      }

      // If it's the current user and we're in create mode, use current user info
      if (isCreateMode && comment.user_id === currentUser?.id) {
        return {
          user_id: comment.user_id,
          first_name: currentUser?.name?.split(' ')[0] || 'Current',
          last_name: currentUser?.name?.split(' ').slice(1).join(' ') || 'User',
          email: currentUser?.email || '',
          user_type: 'internal',
          avatarUrl: currentUser?.avatarUrl || null
        };
      }

      // Fallback for unknown users
      return {
        user_id: comment.user_id,
        first_name: 'Unknown',
        last_name: 'User',
        email: '',
        user_type: 'internal',
        avatarUrl: null
      };
    }
    return null;
  };

  const sortedComments = [...comments].sort((a, b) => {
    const dateA = new Date(a.created_at || 0).getTime();
    const dateB = new Date(b.created_at || 0).getTime();
    return reverseOrder ? dateB - dateA : dateA - dateB;
  });

  return (
    <div className={`${className}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
            <MessageSquare className="w-4 h-4" />
            <span>Comments ({comments.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              id="phase-comments-sort-button"
              type="button"
              onClick={toggleCommentOrder}
              className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>{reverseOrder ? 'Newest first' : 'Oldest first'}</span>
            </button>
            {!showEditor && (
              <Button
                id="phase-add-comment-button"
                onClick={handleAddCommentClick}
                size="sm"
                variant="outline"
              >
                Comment
              </Button>
            )}
          </div>
        </div>

        {/* Add comment form */}
        {showEditor && (
          <div className="border rounded-lg bg-white shadow-sm">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <UserAvatar
                  userId={currentUser?.id || ''}
                  userName={currentUser?.name || ''}
                  avatarUrl={userMap[currentUser?.id || '']?.avatarUrl || currentUser?.avatarUrl || null}
                  size="md"
                />
                <div className="flex-grow">
                  <div className="border rounded-md">
                    {/* Formatting toolbar */}
                    <div className="border-b bg-gray-50 px-3 py-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => insertFormatting('bold', textAreaRef, newCommentContent, setNewCommentContent)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Bold"
                      >
                        <Bold className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting('italic', textAreaRef, newCommentContent, setNewCommentContent)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Italic"
                      >
                        <Italic className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting('code', textAreaRef, newCommentContent, setNewCommentContent)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Code"
                      >
                        <Code className="w-4 h-4" />
                      </button>
                      <div className="w-px h-4 bg-gray-300 mx-1" />
                      <button
                        type="button"
                        onClick={() => insertFormatting('bullet', textAreaRef, newCommentContent, setNewCommentContent)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Bullet List"
                      >
                        <List className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting('numbered', textAreaRef, newCommentContent, setNewCommentContent)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Numbered List"
                      >
                        <ListOrdered className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => insertFormatting('quote', textAreaRef, newCommentContent, setNewCommentContent)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Quote"
                      >
                        <Quote className="w-4 h-4" />
                      </button>
                      <div className="w-px h-4 bg-gray-300 mx-1" />
                      <button
                        type="button"
                        onClick={() => insertFormatting('link', textAreaRef, newCommentContent, setNewCommentContent)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Link"
                      >
                        <Link className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Attach file"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Add emoji"
                      >
                        <Smile className="w-4 h-4" />
                      </button>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowPreview(!showPreview)}
                          className={`px-2 py-1 text-xs rounded ${showPreview ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-200'}`}
                        >
                          <Eye className="w-3 h-3 inline mr-1" />
                          Preview
                        </button>
                      </div>
                    </div>

                    {/* Text area or preview */}
                    {showPreview ? (
                      <div className="p-3 min-h-[100px] text-sm">
                        {newCommentContent ? renderFormattedText(newCommentContent) : (
                          <span className="text-gray-400">Nothing to preview</span>
                        )}
                      </div>
                    ) : (
                      <TextArea
                        ref={textAreaRef}
                        id="phase-comment-input"
                        value={newCommentContent}
                        onChange={(e) => setNewCommentContent(e.target.value)}
                        placeholder="Add a comment... (supports **bold**, *italic*, `code`, [links](url), @mentions)"
                        className="border-0 shadow-none resize-none focus:ring-0 text-sm min-h-[100px]"
                        rows={4}
                      />
                    )}
                  </div>

                  <div className="flex justify-between items-center mt-3">
                    <div className="text-xs text-gray-500">
                      Pro tip: Use @ to mention team members
                    </div>
                    <div className="flex gap-2">
                      <Button
                        id="phase-comment-cancel-button"
                        onClick={handleCancelComment}
                        variant="outline"
                        size="sm"
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        id="phase-comment-save-button"
                        onClick={handleSubmitComment}
                        size="sm"
                        disabled={isSubmitting || !newCommentContent.trim()}
                      >
                        {isSubmitting ? 'Saving...' : 'Comment'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Comments list */}
        <div className="space-y-4">
          {sortedComments.map((comment) => {
            const author = getAuthorInfo(comment);
            const isCurrentlyEditing = editingCommentId === comment.project_phase_comment_id;
            const isHovered = hoveredCommentId === comment.project_phase_comment_id;

            return (
              <div
                key={comment.project_phase_comment_id}
                className="bg-white border rounded-lg p-4 group hover:shadow-sm transition-shadow"
                onMouseEnter={() => setHoveredCommentId(comment.project_phase_comment_id!)}
                onMouseLeave={() => setHoveredCommentId(null)}
              >
                <div className="flex items-start gap-3">
                  <UserAvatar
                    userId={author?.user_id || ''}
                    userName={`${author?.first_name || ''} ${author?.last_name || ''}`}
                    avatarUrl={author?.avatarUrl || null}
                    size="md"
                  />
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {author?.first_name} {author?.last_name}
                        </span>
                        <span className="text-sm text-gray-500">
                          {comment.created_at ? new Date(comment.created_at).toLocaleDateString() : ''}
                        </span>
                        <span className="text-sm text-gray-400">
                          {comment.created_at ? new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      {comment.user_id === currentUser?.id && (isHovered || isCurrentlyEditing) && (
                        <div className="flex items-center gap-1">
                          <button
                            id="phase-comment-edit-button"
                            type="button"
                            onClick={() => handleEdit(comment)}
                            className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Edit comment"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            id="phase-comment-delete-button"
                            type="button"
                            onClick={() => handleDelete(comment)}
                            className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete comment"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="More options"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isCurrentlyEditing ? (
                      <div className="border rounded-md">
                        {/* Edit formatting toolbar */}
                        <div className="border-b bg-gray-50 px-3 py-2 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => insertFormatting('bold', editTextAreaRef, editContent, setEditContent)}
                            className="p-1 hover:bg-gray-200 rounded text-gray-600"
                            title="Bold"
                          >
                            <Bold className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => insertFormatting('italic', editTextAreaRef, editContent, setEditContent)}
                            className="p-1 hover:bg-gray-200 rounded text-gray-600"
                            title="Italic"
                          >
                            <Italic className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => insertFormatting('code', editTextAreaRef, editContent, setEditContent)}
                            className="p-1 hover:bg-gray-200 rounded text-gray-600"
                            title="Code"
                          >
                            <Code className="w-4 h-4" />
                          </button>
                          <div className="w-px h-4 bg-gray-300 mx-1" />
                          <button
                            type="button"
                            onClick={() => insertFormatting('link', editTextAreaRef, editContent, setEditContent)}
                            className="p-1 hover:bg-gray-200 rounded text-gray-600"
                            title="Link"
                          >
                            <Link className="w-4 h-4" />
                          </button>
                          <div className="ml-auto">
                            <button
                              type="button"
                              onClick={() => setShowEditPreview(!showEditPreview)}
                              className={`px-2 py-1 text-xs rounded ${showEditPreview ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-200'}`}
                            >
                              <Eye className="w-3 h-3 inline mr-1" />
                              Preview
                            </button>
                          </div>
                        </div>

                        {/* Edit text area or preview */}
                        {showEditPreview ? (
                          <div className="p-3 min-h-[80px] text-sm">
                            {editContent ? renderFormattedText(editContent) : (
                              <span className="text-gray-400">Nothing to preview</span>
                            )}
                          </div>
                        ) : (
                          <TextArea
                            ref={editTextAreaRef}
                            id="phase-comment-edit-input"
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="border-0 shadow-none resize-none focus:ring-0 text-sm min-h-[80px]"
                            rows={3}
                          />
                        )}

                        <div className="flex justify-end gap-2 p-3 border-t bg-gray-50">
                          <Button
                            id="phase-comment-edit-cancel-button"
                            onClick={handleCancelEdit}
                            variant="outline"
                            size="sm"
                          >
                            Cancel
                          </Button>
                          <Button
                            id="phase-comment-edit-save-button"
                            onClick={handleSaveEdit}
                            disabled={!editContent.trim()}
                            size="sm"
                          >
                            Update
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-700 leading-relaxed">
                        {renderFormattedText(comment.note)}
                      </div>
                    )}

                    {/* Comment reactions/actions */}
                    {!isCurrentlyEditing && (
                      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-gray-100">
                        <button className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1">
                          👍 Like
                        </button>
                        <button className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1">
                          💬 Reply
                        </button>
                        <button className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1">
                          🔗 Copy link
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {comments.length === 0 && !showEditor && (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No comments yet.</p>
              <p className="text-xs text-gray-400 mt-1">Start the conversation by adding a comment.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PhaseComments;