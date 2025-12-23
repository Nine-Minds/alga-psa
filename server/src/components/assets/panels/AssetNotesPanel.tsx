import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { useAssetNotes } from '../../../hooks/useAssetNotes';
import TextEditor from '../../editor/TextEditor';
import { Save } from 'lucide-react';
import Spinner from 'server/src/components/ui/Spinner';

interface AssetNotesPanelProps {
  assetId: string;
}

export const AssetNotesPanel: React.FC<AssetNotesPanelProps> = ({
  assetId
}) => {
  const { 
    noteContent, 
    lastUpdated, 
    isLoading, 
    saveNote, 
    isSaving 
  } = useAssetNotes(assetId);

  // We manage local state for the editor content to avoid jitter
  // but we initialize it from the fetched data
  const [editorContent, setEditorContent] = useState<any>(null);

  useEffect(() => {
    if (noteContent) {
      setEditorContent(noteContent);
    }
  }, [noteContent]);

  const handleSave = async () => {
    if (editorContent) {
      await saveNote(editorContent);
    }
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
            id="save-asset-note-btn"
            variant="ghost" 
            size="sm" 
            className="h-8 gap-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <Spinner size="sm" className="h-3 w-3" /> : <Save size={14} />}
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="min-h-[200px]">
          <TextEditor
            key={assetId}
            initialContent={editorContent}
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