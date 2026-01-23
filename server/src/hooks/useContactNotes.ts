import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getContactNoteContent, saveContactNote } from '@alga-psa/clients/actions';
import { toast } from 'react-hot-toast';

// Type for BlockNote content (simplified)
type PartialBlock = unknown;

export function useContactNotes(contactId: string) {
  // Fetch note content
  const {
    data: noteContent,
    error,
    isLoading,
    mutate: mutateNotes
  } = useSWR(
    contactId ? ['contact', contactId, 'notes'] : null,
    ([_, id]) => getContactNoteContent(id)
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

      await saveContactNote(contactId, payload);

      // Revalidate
      await mutateNotes();

      toast.success('Notes saved');
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('Failed to save notes');
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [contactId, mutateNotes]);

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
