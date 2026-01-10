import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { useClientNotes } from '../../../hooks/useClientNotes';
import TextEditor from '../../editor/TextEditor';
import { Save, Loader2 } from 'lucide-react';
import { DEFAULT_BLOCK } from '../../editor/TextEditor';
import { Alert, AlertDescription, AlertTitle } from 'server/src/components/ui/Alert';
import { PartialBlock } from '@blocknote/core';

interface ClientNotesPanelProps {
  clientId: string;
  /**
   * Legacy plain-text notes from the old system.
   * Displayed read-only above the rich text editor for backward compatibility.
   */
  legacyNotes?: string | null;
}

export const ClientNotesPanel: React.FC<ClientNotesPanelProps> = ({
  clientId,
  legacyNotes
}) => {
  const {
    noteContent,
    noteDocument,
    lastUpdated,
    isLoading,
    error,
    saveNote,
    refresh,
    isSaving
  } = useClientNotes(clientId);

  // Track local edits for saving (avoid jitter from revalidation).
  const [editorContent, setEditorContent] = useState<PartialBlock[] | null>(null);

  const handleSave = async () => {
    const contentToSave = editorContent ?? noteContent ?? DEFAULT_BLOCK;
    await saveNote(contentToSave);
  };

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  return (
    <Card className="bg-white">
      <CardHeader className="pb-2">
        <div className="flex flex-row items-center justify-between">
          <CardTitle>Notes & Quick Info</CardTitle>
          <Button
            id="save-client-note-btn"
            variant="ghost"
            size="sm"
            className="h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50"
            onClick={handleSave}
            disabled={isSaving || !!error}
          >
            {isSaving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Legacy notes display for backward compatibility */}
        {legacyNotes && legacyNotes.trim() !== '' && (
          <div className="bg-gray-100 border border-gray-200 rounded-md p-4 mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Initial Note</h4>
            <p className="whitespace-pre-wrap text-sm text-gray-600">{legacyNotes}</p>
          </div>
        )}

        {error && (
          <div className="mb-3">
            <Alert variant="destructive">
              <AlertTitle>Notes failed to load</AlertTitle>
              <AlertDescription>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    {error instanceof Error ? error.message : 'Unknown error'}
                  </span>
                  <Button
                    id="retry-client-notes-btn"
                    variant="outline"
                    size="sm"
                    onClick={() => void refresh()}
                  >
                    Retry
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        )}
        <div className="min-h-[200px]">
          <TextEditor
            id={`client-${clientId}-notes-editor`}
            // Remount when the backing document changes (or first loads) so saved notes show up on open.
            key={`${clientId}-${noteDocument?.document_id ?? 'new'}-${noteContent ? 'loaded' : 'empty'}`}
            initialContent={
              noteContent && Array.isArray(noteContent) && noteContent.length > 0
                ? noteContent
                : typeof noteContent === 'string'
                ? noteContent
                : DEFAULT_BLOCK
            }
            onContentChange={setEditorContent}
          />
        </div>

        {lastUpdated && (
          <div className="flex justify-end mt-2">
            <span className="text-xs text-gray-500">
              Last updated: {new Date(lastUpdated).toLocaleString()}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
