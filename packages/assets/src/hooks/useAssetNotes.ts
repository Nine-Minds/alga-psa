import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { getAssetNoteContent, saveAssetNote } from '@alga-psa/assets/actions/assetNoteActions';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type PartialBlock = unknown;
const isAssetActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
  isActionPermissionError(value) || isActionMessageError(value);

export function useAssetNotes(assetId: string) {
  const { data: noteContent, error, isLoading, mutate: mutateNotes } = useSWR(
    assetId ? ['asset', assetId, 'notes'] : null,
    async ([_, id]) => {
      const result = await getAssetNoteContent(id);
      if (isAssetActionError(result)) {
        throw new Error(getErrorMessage(result));
      }
      return result;
    }
  );

  const [isSaving, setIsSaving] = useState(false);

  const saveNote = useCallback(
    async (blockData: PartialBlock) => {
      if (!assetId) return;

      try {
        setIsSaving(true);
        const payload = typeof blockData === 'string' ? blockData : JSON.stringify(blockData);

        const result = await saveAssetNote(assetId, payload);
        if (isAssetActionError(result)) {
          toast.error(getErrorMessage(result));
          return;
        }

        await mutateNotes();

        toast.success('Notes saved');
      } catch (error) {
        console.error('Error saving notes:', error);
        toast.error('Failed to save notes');
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
