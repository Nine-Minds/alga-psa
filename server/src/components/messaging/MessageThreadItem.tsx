'use client';

import { MessageThread } from 'server/src/interfaces/messaging.interfaces';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { Badge } from 'server/src/components/ui/Badge';
import { formatDistanceToNow } from 'date-fns';
import { useState, useEffect } from 'react';

interface MessageThreadItemProps {
  thread: MessageThread;
  onClose: () => void;
}

export function MessageThreadItem({ thread, onClose }: MessageThreadItemProps) {
  const [participantInfo, setParticipantInfo] = useState<any>(null);

  // TODO: Load participant user info
  useEffect(() => {
    // This would fetch user details for the other participant
    // For now, using placeholder data
    setParticipantInfo({
      full_name: 'Team Member',
      avatar_url: null,
    });
  }, [thread.participants]);

  const handleThreadClick = () => {
    // Navigate to full thread view
    window.location.href = `/msp/messages/thread/${thread.thread_id}`;
    onClose();
  };

  const truncateMessage = (message: string, maxLength: number = 50) => {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  };

  return (
    <div 
      className="p-3 hover:bg-gray-50 cursor-pointer transition-colors"
      onClick={handleThreadClick}
    >
      <div className="flex items-start gap-3">
        <UserAvatar 
          userId="participant"
          userName={participantInfo?.full_name || 'Team Member'}
          avatarUrl={participantInfo?.avatar_url || null}
          size="sm"
          className="mt-1"
        />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium text-gray-900 truncate">
              {participantInfo?.full_name || 'Unknown User'}
            </p>
            <div className="flex items-center gap-2">
              {thread.unread_count > 0 && (
                <Badge variant="error" className="text-xs">
                  {thread.unread_count}
                </Badge>
              )}
              <span className="text-xs text-gray-500">
                {thread.last_message && formatDistanceToNow(thread.last_message.created_at, { addSuffix: true })}
              </span>
            </div>
          </div>
          
          {thread.last_message && (
            <p className={`text-sm ${thread.unread_count > 0 ? 'font-medium text-gray-900' : 'text-gray-600'} truncate`}>
              {truncateMessage(thread.last_message.message)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}