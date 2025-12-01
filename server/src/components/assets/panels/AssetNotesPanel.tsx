'use client';

import React, { useEffect, useState } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { Button, Text, Group } from '@mantine/core';
import { useAssetNotes } from '../../../hooks/useAssetNotes';
import TextEditor from '../../editor/TextEditor';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Save } from 'lucide-react';

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
    <Card 
      title="Notes & Quick Info"
      action={
        <Button 
          variant="light" 
          size="xs" 
          leftSection={<Save size={14} />}
          onClick={handleSave}
          loading={isSaving}
        >
          Save
        </Button>
      }
    >
      <div className="min-h-[200px]">
        <TextEditor
          key={assetId}
          initialContent={editorContent}
          onContentChange={setEditorContent}
        />
      </div>
      
      {lastUpdated && (
        <Group justify="flex-end" mt="xs">
          <Text size="xs" c="dimmed">
            Last updated: {new Date(lastUpdated).toLocaleString()}
          </Text>
        </Group>
      )}
    </Card>
  );
};