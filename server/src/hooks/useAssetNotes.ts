import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getAssetNoteContent, saveAssetNote } from '../lib/actions/asset-actions/assetNoteActions';
import { toast } from 'react-hot-toast';
import { getCurrentUser } from '../lib/actions/user-actions/userActions';

// Type for BlockNote content (simplified)
type PartialBlock = unknown;

export function useAssetNotes(assetId: string) {
  // Fetch note content
  const { 
    data: noteContent, 
    error, 
    isLoading,
    mutate: mutateNotes
  } = useSWR(
    assetId ? ['asset', assetId, 'notes'] : null,
    ([_, id]) => getAssetNoteContent(id)
  );

  const [isSaving, setIsSaving] = useState(false);

  const saveNote = useCallback(async (blockData: PartialBlock) => {
    if (!assetId) return;

    try {
      setIsSaving(true);
      // We don't need to pass userId here as the server action gets it from session
      // but the plan mentioned passing it. The implemented action uses getCurrentUser internally.
      // Checking saveAssetNote signature: it takes (assetId, blockData).
      await saveAssetNote(assetId, blockData);
      
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
  }, [assetId, mutateNotes]);

  return {
    noteContent: noteContent?.blockData,
    noteDocument: noteContent?.document,
    lastUpdated: noteContent?.lastUpdated,
    isLoading,
    error,
    saveNote,
    isSaving
  };
}
