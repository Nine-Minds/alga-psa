'use client';

import { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import UserPicker from 'server/src/components/ui/UserPicker';
import { sendDirectMessageAction } from 'server/src/lib/actions/messaging-actions/directMessageActions';
import { toast } from 'react-hot-toast';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';

interface NewConversationDialogProps {
  open: boolean;
  onClose: () => void;
  onConversationStarted: (threadId: string) => void;
}

export function NewConversationDialog({ open, onClose, onConversationStarted }: NewConversationDialogProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [users, setUsers] = useState<IUserWithRoles[]>([]);

  // Load users when dialog opens
  useEffect(() => {
    if (open) {
      loadUsers();
    }
  }, [open]);

  const loadUsers = async () => {
    try {
      const usersList = await getAllUsers(true, 'internal');
      setUsers(usersList);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast.error('Failed to load users');
    }
  };

  const handleSendMessage = async () => {
    if (!selectedUserId || !message.trim()) {
      toast.error('Please select a user and enter a message');
      return;
    }

    setIsLoading(true);
    try {
      const result = await sendDirectMessageAction({
        recipient_id: selectedUserId,
        message: message.trim(),
      });

      toast.success('Message sent successfully');
      onConversationStarted(result.thread_id || '');
      
      // Reset form
      setSelectedUserId('');
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedUserId('');
    setMessage('');
    onClose();
  };

  return (
    <Dialog isOpen={open} onClose={handleClose}>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
        <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">New Message</h2>
            
            <div className="space-y-4">
              <div>
                <UserPicker
                  label="To:"
                  value={selectedUserId}
                  onValueChange={setSelectedUserId}
                  users={users}
                  placeholder="Select a team member..."
                  buttonWidth="full"
                  data-automation-id="message-recipient-picker"
                />
              </div>

              <div>
                <Label htmlFor="message">Message:</Label>
                <TextArea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your message here..."
                  rows={4}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button 
                id="cancel-message"
                variant="ghost" 
                onClick={handleClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button 
                id="send-message"
                onClick={handleSendMessage}
                disabled={!selectedUserId || !message.trim() || isLoading}
              >
                {isLoading ? 'Sending...' : 'Send Message'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}