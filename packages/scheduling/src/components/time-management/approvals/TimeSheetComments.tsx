'use client'

import React, { useState } from 'react';
import { ITimeSheetComment, TimeSheetStatus } from '@alga-psa/types';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';

interface TimeSheetCommentsProps {
    comments: ITimeSheetComment[];
    onAddComment: (comment: string) => Promise<void>;
    timeSheetStatus: TimeSheetStatus;
    timeSheetId: string;
    onCommentsUpdate: (comments: ITimeSheetComment[]) => void;
}

export function TimeSheetComments({
    comments,
    onAddComment,
    timeSheetStatus,
    timeSheetId,
    onCommentsUpdate
}: TimeSheetCommentsProps): React.JSX.Element {
    const { t } = useTranslation('msp/time-entry');
    const { formatDate } = useFormatters();
    const [newComment, setNewComment] = useState<string>('');
    const [isAddingComment, setIsAddingComment] = useState<boolean>(false);

    const handleAddComment = async (): Promise<void> => {
        if (newComment.trim() && !isAddingComment) {
            setIsAddingComment(true);
            try {
                await onAddComment(newComment);
                setNewComment('');
            } catch (error) {
                console.error('Failed to add comment:', error);
            } finally {
                setIsAddingComment(false);
            }
        }
    };

    const getCommentTypeDisplay = (isApprover: boolean): {
        className: string;
        text: string;
        wrapperClassName: string;
    } => {
        if (isApprover) {
            return {
                className: 'text-orange-600',
                text: t('approval.labels.approver', { defaultValue: 'Approver' }),
                wrapperClassName: 'text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded'
            };
        }
        return {
            className: '',
            text: t('approval.labels.employee', { defaultValue: 'Employee' }),
            wrapperClassName: 'text-xs bg-gray-100 dark:bg-gray-800/30 text-gray-800 dark:text-gray-300 px-2 py-1 rounded'
        };
    };

    return (
        <div className="space-y-4">
            {comments.map((comment): React.JSX.Element => {
                const commentType = getCommentTypeDisplay(comment.is_approver);
                return (
                    <div 
                        key={comment.comment_id} 
                        className={`${comment.is_approver ? 'p-3 rounded shadow bg-orange-50 border border-orange-200' : 'p-3 rounded shadow bg-white'}`}
                    >
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                                <p className="font-semibold">
                                    <span className={commentType.className}>
                                        {comment.user_name}
                                    </span>
                                </p>
                                <span className={commentType.wrapperClassName}>
                                    {commentType.text}
                                </span>
                            </div>
                            <p className="text-sm text-gray-500">
                                {formatDate(new Date(comment.created_at), {
                                    dateStyle: 'medium',
                                    timeStyle: 'short'
                                })}
                            </p>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">{comment.comment}</p>
                    </div>
                );
            })}
            <div className="mt-4">
                <TextArea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={timeSheetStatus === 'CHANGES_REQUESTED' ? 
                        t('comments.responsePlaceholder', { defaultValue: 'Respond to the requested changes...' }) : 
                        t('comments.placeholder', { defaultValue: 'Add a comment...' })}
                    className={timeSheetStatus === 'CHANGES_REQUESTED' ? 
                        'border-orange-200 focus:border-orange-500' : ''}
                />
                <Button
                    id="add-comment-button"
                    onClick={handleAddComment}
                    disabled={isAddingComment}
                    className={`mt-2 ${timeSheetStatus === 'CHANGES_REQUESTED' ? 
                        'bg-orange-500 hover:bg-orange-600' : ''}`}
                >
                    {isAddingComment ? t('common.actions.adding', { defaultValue: 'Adding...' }) : 
                        timeSheetStatus === 'CHANGES_REQUESTED' ? 
                        t('comments.respondToChanges', { defaultValue: 'Respond to Changes' }) : t('common.actions.addComment', { defaultValue: 'Add Comment' })}
                </Button>
            </div>
        </div>
    );
}
