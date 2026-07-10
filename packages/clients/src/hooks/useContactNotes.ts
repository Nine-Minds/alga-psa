'use client';

import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getContactNoteContent, saveContactNote } from '@alga-psa/clients/actions';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type PartialBlock = unknown;
const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

export function useContactNotes(contactId: string) {
  const { data: noteContent, error, isLoading, mutate: mutateNotes } = useSWR(
    contactId ? ['contact', contactId, 'notes'] : null,
    async ([_, id]) => {
      const result = await getContactNoteContent(id);
      if (isReturnedActionError(result)) {
        throw new Error(getErrorMessage(result));
      }
      return result;
    }
  );

  const [isSaving, setIsSaving] = useState(false);

  const saveNote = useCallback(
    async (blockData: PartialBlock) => {
      if (!contactId) return;

      try {
        setIsSaving(true);
        const payload = typeof blockData === 'string' ? blockData : JSON.stringify(blockData);

        const result = await saveContactNote(contactId, payload);
        if (isReturnedActionError(result)) {
          throw new Error(getErrorMessage(result));
        }

        await mutateNotes();

        toast.success('Notes saved');
      } catch (error) {
        console.error('Error saving notes:', error);
        toast.error(getErrorMessage(error));
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [contactId, mutateNotes]
  );

  return {
    noteContent: noteContent?.blockData,
    noteDocument: noteContent?.document,
    lastUpdated: noteContent?.lastUpdated,
    isLoading,
    error,
    saveNote,
    refresh: mutateNotes,
    isSaving,
  };
}
