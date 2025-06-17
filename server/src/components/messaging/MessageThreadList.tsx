'use client';

import { MessageThread } from 'server/src/interfaces/messaging.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Mail, Plus } from 'lucide-react';
import { MessageThreadItem } from './MessageThreadItem';
import { useState } from 'react';
import { NewConversationDialog } from './NewConversationDialog';

interface MessageThreadListProps {
  threads: MessageThread[];
  isLoading: boolean;
  onClose: () => void;
}

export function MessageThreadList({ threads, isLoading, onClose }: MessageThreadListProps) {
  const [showNewConversationDialog, setShowNewConversationDialog] = useState(false);

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="animate-spin h-8 w-8 border-2 border-gray-300 border-t-blue-600 rounded-full mx-auto mb-4"></div>
        <p>Loading messages...</p>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Mail className="h-12 w-12 mx-auto mb-4 text-gray-300" />
        <p>No messages yet</p>
        <p className="text-sm mb-4">Start a conversation with your team</p>
        <Button 
          id="new-message-button"
          size="sm" 
          onClick={() => setShowNewConversationDialog(true)}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Message
        </Button>
        
        <NewConversationDialog
          open={showNewConversationDialog}
          onClose={() => setShowNewConversationDialog(false)}
          onConversationStarted={() => {
            setShowNewConversationDialog(false);
            onClose();
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-h-96">
      <div className="p-3 border-b bg-gray-50">
        <Button
          id="new-message-empty-button"
          variant="ghost"
          size="sm"
          onClick={() => setShowNewConversationDialog(true)}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Message
        </Button>
      </div>
      
      <div className="max-h-80 overflow-y-auto">
        <div className="divide-y">
          {threads.map((thread) => (
            <MessageThreadItem
              key={thread.thread_id}
              thread={thread}
              onClose={onClose}
            />
          ))}
        </div>
      </div>


      <NewConversationDialog
        open={showNewConversationDialog}
        onClose={() => setShowNewConversationDialog(false)}
        onConversationStarted={() => {
          setShowNewConversationDialog(false);
          onClose();
        }}
      />
    </div>
  );
}