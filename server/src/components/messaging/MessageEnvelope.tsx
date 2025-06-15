'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { useDirectMessages } from 'server/src/lib/hooks/useDirectMessages';
import { MessageThreadList } from './MessageThreadList';

export function MessageEnvelope() {
  const { threads, unreadMessageCount, isLoading } = useDirectMessages();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          id="message-envelope"
          variant="ghost"
          size="icon"
          className="relative p-2 h-10 w-10"
          data-automation-id="message-envelope"
        >
          <Mail className="h-5 w-5" />
          {unreadMessageCount > 0 && (
            <Badge 
              variant="error" 
              className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
            >
              {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-96 p-0" align="end">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Messages</h4>
            <div className="flex items-center gap-2">
              {unreadMessageCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {unreadMessageCount} unread
                </Badge>
              )}
            </div>
          </div>
        </div>
        <MessageThreadList 
          threads={threads} 
          isLoading={isLoading}
          onClose={() => setIsOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}