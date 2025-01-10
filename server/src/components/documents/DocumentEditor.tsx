'use client';

import { useEffect, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { getBlockContent, updateBlockContent } from '@/lib/actions/document-actions/documentBlockContentActions';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface DocumentEditorProps {
  documentId: string;
  userId: string;
}

export function DocumentEditor({ documentId, userId }: DocumentEditorProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize the editor
  const editor = useCreateBlockNote();

  // Load the document content when component mounts
  useEffect(() => {
    const loadContent = async () => {
      try {
        setIsLoading(true);
        const content = await getBlockContent(documentId);
        if (content?.block_data) {
          try {
            // Parse the JSON string into blocks
            const blocks = JSON.parse(content.block_data);
            // Replace the editor content with the loaded blocks
            editor.replaceBlocks(editor.document, blocks);
          } catch (parseError) {
            console.error('Error parsing block data:', parseError);
            setError('Failed to parse document content');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document content');
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [documentId, editor]);

  // Save the document content
  const handleSave = async () => {
    try {
      setIsSaving(true);
      // Get the current editor content and stringify
      const blocks = editor.document;
      
      await updateBlockContent(documentId, {
        block_data: JSON.stringify(blocks),
        user_id: userId
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document');
    } finally {
      setIsSaving(false);
    }
  };

  if (error) {
    return (
      <Card className="p-4">
        <div className="text-red-500">Error: {error}</div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-4 flex justify-end">
        <Button
          id="save-document-button"
          onClick={handleSave}
          disabled={isLoading || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          Loading...
        </div>
      ) : (
        <BlockNoteView editor={editor} />
      )}
    </Card>
  );
}
