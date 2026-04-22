import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getClientNoteContent, saveClientNote } from '@alga-psa/clients/actions';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Type for BlockNote content (simplified)
type PartialBlock = unknown;

export function useClientNotes(clientId: string) {
  const { t } = useTranslation('msp/clients');
  // Fetch note content
  const {
    data: noteContent,
    error,
    isLoading,
    mutate: mutateNotes
  } = useSWR(
    clientId ? ['client', clientId, 'notes'] : null,
    ([_, id]) => getClientNoteContent(id)
  );

  const [isSaving, setIsSaving] = useState(false);

  const saveNote = useCallback(async (blockData: PartialBlock) => {
    if (!clientId) return;

    try {
      setIsSaving(true);
      // Important: Send a JSON string across the server-action boundary to avoid any
      // serialization quirks with BlockNote objects.
      const payload =
        typeof blockData === 'string'
          ? blockData
          : JSON.stringify(blockData);

      await saveClientNote(clientId, payload);

      // Revalidate
      await mutateNotes();

      toast.success(t('notes.messages.saveSuccess', 'Notes saved'));
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error(t('notes.messages.saveFailed', 'Failed to save notes'));
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [clientId, mutateNotes, t]);

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
