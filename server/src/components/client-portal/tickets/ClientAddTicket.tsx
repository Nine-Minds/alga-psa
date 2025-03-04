'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { AlertCircle, X } from 'lucide-react';
import { createClientTicket } from 'server/src/lib/actions/client-portal-actions/client-tickets';
import { getTicketFormData } from 'server/src/lib/actions/ticket-actions/ticketFormActions';
import { IPriority } from 'server/src/interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { useRouter } from 'next/navigation';

interface ClientAddTicketProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClientAddTicket({ open, onOpenChange }: ClientAddTicketProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [priorities, setPriorities] = useState<IPriority[]>([]);

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false);
      setIsLoading(false);
      resetForm();
      return;
    }

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const formData = await getTicketFormData();
        setPriorities(formData.priorities);
      } catch (error) {
        console.error('Error fetching form data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [open]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setError(null);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriorityId('');
    setError(null);
    setHasAttemptedSubmit(false);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const validateForm = () => {
    const validationErrors = [];
    if (!title.trim()) validationErrors.push('Title is required');
    if (!description.trim()) validationErrors.push('Description is required');
    if (!priorityId) validationErrors.push('Please select a priority');
    return validationErrors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setHasAttemptedSubmit(true);

    try {
      const validationErrors = validateForm();
      if (validationErrors.length > 0) {
        throw new Error(validationErrors.join('\n'));
      }

      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('priority_id', priorityId);

      await createClientTicket(formData);
      resetForm();
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      console.error('Error creating ticket:', error);
      setError(error instanceof Error ? error.message : 'Failed to create ticket. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const memoizedPriorityOptions = useMemo(
    () =>
      priorities.map((priority) => ({
        value: priority.priority_id,
        label: priority.priority_name
      })),
    [priorities]
  );

  return (
    <Dialog isOpen={open} onClose={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Support Ticket</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center p-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
          </div>
        ) : (
          <>
            {hasAttemptedSubmit && error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start space-x-2">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-red-700 text-sm">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <Input
                id="client-ticket-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  clearErrorIfSubmitted();
                }}
                placeholder="Ticket Title"
              />
              
              <TextArea
                id="client-ticket-description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearErrorIfSubmitted();
                }}
                placeholder="Describe your issue..."
              />

              <div className="relative z-10">
                <CustomSelect
                  id="client-ticket-priority"
                  value={priorityId}
                  onValueChange={(value) => {
                    setPriorityId(value);
                    clearErrorIfSubmitted();
                  }}
                  options={memoizedPriorityOptions}
                  placeholder="Select Priority"
                />
              </div>

              <DialogFooter>
                <Button
                  id="cancel-ticket-button"
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button
                  id="submit-ticket-button"
                  type="submit"
                  variant="default"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Ticket'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
            <Button
              id="close-dialog-button"
              variant="ghost"
              size="sm"
              className="absolute top-4 right-4 p-0 w-6 h-6 flex items-center justify-center"
              aria-label="Close"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>

      </DialogContent>
    </Dialog>
  );
}
