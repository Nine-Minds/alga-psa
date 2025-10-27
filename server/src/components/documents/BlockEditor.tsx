'use client';

import { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { getBlockContent, updateBlockContent } from '@product/actions/document-actions/documentBlockContentActions';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';

interface BlockEditorProps {
  documentId: string;
  userId: string;
}

export function BlockEditor({ documentId, userId }: BlockEditorProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editorReady, setEditorReady] = useState(false);

  // Initialize the editor
  const editor = useEditor({
    extensions: [
      StarterKit,
    ],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none',
      },
    },
    onCreate: () => {
      setEditorReady(true);
    },
    onDestroy: () => {
      setEditorReady(false);
    },
  });

  // Load the document content when component mounts
  useEffect(() => {
    const loadContent = async () => {
      try {
        setIsLoading(true);
        const content = await getBlockContent(documentId);
        if (content?.block_data) {
          try {
            const parsedContent = typeof content.block_data === 'string'
              ? JSON.parse(content.block_data)
              : content.block_data;
            if (editor && !editor.isDestroyed) {
              editor.commands.setContent(parsedContent);
            }
          } catch (parseError) {
            console.error('Error parsing content:', parseError);
            setError('Failed to parse document content');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document content');
      } finally {
        setIsLoading(false);
      }
    };

    if (editor && !editor.isDestroyed) {
      loadContent();
    }
  }, [documentId, editor]);

  // Save the document content
  const handleSave = async () => {
    if (!editor || editor.isDestroyed) return;

    try {
      setIsSaving(true);
      // Get the current editor content as JSON
      const content = editor.getJSON();
      
      await updateBlockContent(documentId, {
        block_data: JSON.stringify(content),
        user_id: userId
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document');
    } finally {
      setIsSaving(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    };
  }, [editor]);

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
          id='handle-save-button'
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
        editor && editorReady && !editor.isDestroyed ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="flex justify-center items-center h-64">
            Initializing editor...
          </div>
        )
      )}
    </Card>
  );
}
