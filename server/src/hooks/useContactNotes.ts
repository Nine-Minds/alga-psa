import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getContactNoteContent, saveContactNote } from '@alga-psa/clients/actions';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

// Type for BlockNote content (simplified)
type PartialBlock = unknown;
const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

export function useContactNotes(contactId: string) {
  const { t } = useTranslation('msp/contacts');
  // Fetch note content
  const {
    data: noteContent,
    error,
    isLoading,
    mutate: mutateNotes
  } = useSWR(
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

  const saveNote = useCallback(async (blockData: PartialBlock) => {
    if (!contactId) return;

    try {
      setIsSaving(true);
      // Important: Send a JSON string across the server-action boundary to avoid any
      // serialization quirks with BlockNote objects.
      const payload =
        typeof blockData === 'string'
          ? blockData
          : JSON.stringify(blockData);

      const result = await saveContactNote(contactId, payload);
      if (isReturnedActionError(result)) {
        throw new Error(getErrorMessage(result));
      }

      // Revalidate
      await mutateNotes();

      toast.success(t('notes.messages.saveSuccess', 'Notes saved'));
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error(getErrorMessage(error) || t('notes.messages.saveFailed', 'Failed to save notes'));
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [contactId, mutateNotes, t]);

  return {
    noteContent: noteContent?.blockData,
    noteDocument: noteContent?.document,
    lastUpdated: noteContent?.lastUpdated,
    isLoading,
    error,
    saveNote,
    refresh: mutateNotes,
    isSaving
  };
}
