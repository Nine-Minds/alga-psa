import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getClientNoteContent, saveClientNote } from '../lib/actions/client-actions/clientNoteActions';
import { toast } from 'react-hot-toast';

// Type for BlockNote content (simplified)
type PartialBlock = unknown;

export function useClientNotes(clientId: string) {
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

      toast.success('Notes saved');
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('Failed to save notes');
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [clientId, mutateNotes]);

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
