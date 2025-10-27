'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import Spinner from 'server/src/components/ui/Spinner';
import { AlertCircle } from 'lucide-react';
import { createClientTicket } from '@product/actions/client-portal-actions/client-tickets';
import { getClientTicketFormData } from '@product/actions/ticket-actions/ticketFormActions';
import { IPriority } from 'server/src/interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { useTranslation } from 'server/src/lib/i18n/client';

interface ClientAddTicketProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketAdded?: () => void;
}

export function ClientAddTicket({ open, onOpenChange, onTicketAdded }: ClientAddTicketProps) {
  const { t } = useTranslation('clientPortal');
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
        const formData = await getClientTicketFormData();
        setPriorities(formData.priorities as IPriority[]);
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
    const validationErrors: string[] = [];
    if (!title.trim()) validationErrors.push(t('tickets.create.errors.titleRequired'));
    if (!description.trim()) validationErrors.push(t('tickets.create.errors.descriptionRequired'));
    if (!priorityId) validationErrors.push(t('tickets.create.errors.priorityRequired'));
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
      onTicketAdded?.();
    } catch (error) {
      console.error('Error creating ticket:', error);
      // Map backend error messages to translation keys
      let errorMessage = t('tickets.create.errors.createFailed');
      if (error instanceof Error) {
        const errorMap: Record<string, string> = {
          'Failed to create ticket': t('tickets.messages.failedToCreateTicket'),
          'Contact not associated with a client': t('tickets.messages.contactNotAssociatedWithClient'),
          'User not associated with a contact': t('tickets.messages.userNotAssociatedWithContact'),
          'Not authenticated': t('tickets.messages.notAuthenticated'),
          'User ID not found in session': t('tickets.messages.userNotFound'),
          'Tenant not found in session. Please log out and log back in.': t('tickets.messages.tenantNotFound'),
        };
        errorMessage = errorMap[error.message] || error.message;
      }
      setError(errorMessage);
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
    <Dialog 
      isOpen={open} 
      onClose={handleClose} 
      title={t('tickets.create.title')}
    >
      <DialogContent className="max-w-2xl">
        {isLoading ? (
          <div className="flex items-center justify-center p-6">
            <Spinner size="sm" />
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
                placeholder={t('tickets.create.titlePlaceholder')}
              />
              
              <TextArea
                id="client-ticket-description"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearErrorIfSubmitted();
                }}
                placeholder={t('tickets.create.descriptionPlaceholder')}
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
                  placeholder={t('tickets.create.priorityPlaceholder')}
                />
              </div>

              <DialogFooter>
                <Button
                  id="cancel-ticket-button"
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  id="submit-ticket-button"
                  type="submit"
                  variant="default"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? t('tickets.create.submitting') : t('tickets.create.submit')}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
