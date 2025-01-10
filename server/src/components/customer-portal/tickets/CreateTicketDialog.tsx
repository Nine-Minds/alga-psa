'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TextArea } from '@/components/ui/TextArea';
import CustomSelect from '@/components/ui/CustomSelect';
import { X, AlertCircle } from 'lucide-react';
import { createClientTicket } from '@/lib/actions/client-tickets';

interface CreateTicketDialogProps {
  open: boolean;
  onClose: () => void;
}

const priorities = [
  { value: '1', label: 'Low' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'High' },
  { value: '4', label: 'Critical' }
];

export function CreateTicketDialog({ open, onClose }: CreateTicketDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('priority_id', priority);

      await createClientTicket(formData);
      
      // Reset form and close dialog
      setTitle('');
      setDescription('');
      setPriority('');
      onClose();
      
      // Refresh the page to show the new ticket
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create ticket');
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-96 max-h-[90vh] overflow-y-auto animate-scale-in">
          <Dialog.Title className="text-xl font-bold mb-4">Create Support Ticket</Dialog.Title>
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start space-x-2">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ticket Title"
                required
              />
            </div>

            <div>
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your issue..."
                required
                rows={4}
              />
            </div>

            <div>
              <CustomSelect
                value={priority}
                onValueChange={(value) => setPriority(value)}
                options={priorities}
                placeholder="Select Priority"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-4">
              <Button id="cancel-ticket-button" type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button id="submit-ticket-button" type="submit" variant="default">
                Create Ticket
              </Button>
            </div>
          </form>

          <Dialog.Close asChild>
            <Button
              id="close-dialog-button"
              variant="ghost"
              size="sm"
              className="absolute top-4 right-4 p-0 w-6 h-6 flex items-center justify-center"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
