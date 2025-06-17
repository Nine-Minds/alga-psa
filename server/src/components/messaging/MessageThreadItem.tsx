'use client';

import { MessageThread } from 'server/src/interfaces/messaging.interfaces';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { Badge } from 'server/src/components/ui/Badge';
import { formatDistanceToNow } from 'date-fns';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { getUserWithRoles } from 'server/src/lib/actions/user-actions/userActions';
import { useDrawer } from 'server/src/context/DrawerContext';
import { ConversationDrawerContent } from './ConversationDrawer';

interface MessageThreadItemProps {
  thread: MessageThread;
  onClose: () => void;
}

export function MessageThreadItem({ thread, onClose }: MessageThreadItemProps) {
  const { data: session } = useSession();
  const [participantInfo, setParticipantInfo] = useState<any>(null);
  const { openDrawer } = useDrawer();

  // Load participant user info
  useEffect(() => {
    const loadParticipantInfo = async () => {
      if (!session?.user?.id || !thread.participants) return;
      
      // Find the other participant (not the current user)
      const otherParticipantId = thread.participants.find(id => id !== session.user.id);
      
      if (otherParticipantId) {
        // Set default info immediately to avoid "Unknown User"
        setParticipantInfo({
          user_id: otherParticipantId,
          full_name: 'Loading...',
          avatar_url: null,
        });
        
        try {
          const user = await getUserWithRoles(otherParticipantId);
          if (user) {
            setParticipantInfo({
              user_id: user.user_id,
              full_name: `${user.first_name} ${user.last_name}`.trim() || 'Team Member',
              avatar_url: user.avatarUrl,
            });
          } else {
            // Fallback if user not found
            setParticipantInfo({
              user_id: otherParticipantId,
              full_name: 'Team Member',
              avatar_url: null,
            });
          }
        } catch (error) {
          console.error('Failed to load participant info:', error);
          setParticipantInfo({
            user_id: otherParticipantId,
            full_name: 'Team Member',
            avatar_url: null,
          });
        }
      }
    };
    
    loadParticipantInfo();
  }, [thread.participants, session]);

  const handleThreadClick = () => {
    const otherParticipantId = thread.participants.find(id => id !== session?.user?.id);
    
    // Close the popover first
    onClose();
    
    openDrawer(
      <ConversationDrawerContent 
        threadId={thread.thread_id}
        participantId={otherParticipantId}
      />,
      undefined // no onMount needed
    );
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
          userId={participantInfo?.user_id || 'unknown'}
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