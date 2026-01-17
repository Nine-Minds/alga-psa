import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getAssetNoteContent, saveAssetNote } from '@alga-psa/assets/actions/assetNoteActions';
import { toast } from 'react-hot-toast';

type PartialBlock = unknown;

export function useAssetNotes(assetId: string) {
  const { data: noteContent, error, isLoading, mutate: mutateNotes } = useSWR(
    assetId ? ['asset', assetId, 'notes'] : null,
    ([_, id]) => getAssetNoteContent(id)
  );

  const [isSaving, setIsSaving] = useState(false);

  const saveNote = useCallback(
    async (blockData: PartialBlock) => {
      if (!assetId) return;

      try {
        setIsSaving(true);
        const payload = typeof blockData === 'string' ? blockData : JSON.stringify(blockData);

        await saveAssetNote(assetId, payload);

        await mutateNotes();

        toast.success('Notes saved');
      } catch (error) {
        console.error('Error saving notes:', error);
        toast.error('Failed to save notes');
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [assetId, mutateNotes]
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

