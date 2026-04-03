'use client';

import { useEffect, useState, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Emoticon } from '@alga-psa/ui/editor';
import { marked } from 'marked';
import { getBlockContent, updateBlockContent } from '../actions/documentBlockContentActions';
import {
  detectBlockContentFormat,
  blockNoteJsonToProsemirrorJson,
  parseBlockContent,
  normalizeProsemirrorJson,
  isRawMarkdownInProsemirror,
  convertRawMarkdownProsemirror,
} from '../lib/blockContentFormat';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { useRegisterUnsavedChanges } from '@alga-psa/ui/context';
import { EditorToolbar } from './EditorToolbar';
import styles from './DocumentEditor.module.css';

interface DocumentEditorProps {
  documentId: string;
  userId: string;
  placeholder?: string;
  editorRef?: React.MutableRefObject<Editor | null>;
  onContentChange?: (content: Record<string, any>) => void;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
  hideSaveButton?: boolean;
  /** Pre-loaded block_data. When provided (even as null), skips the getBlockContent fetch. */
  initialContent?: unknown;
}

export function DocumentEditor({
  documentId,
  userId,
  placeholder,
  editorRef,
  onContentChange,
  onUnsavedChangesChange,
  hideSaveButton = false,
  initialContent,
}: DocumentEditorProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const contentLoadedRef = useRef(false);

  // Register unsaved changes for navigation protection
  useRegisterUnsavedChanges(`document-editor-${documentId}`, hasUnsavedChanges);

  // Initialize the editor
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Underline,
      Emoticon,
    ],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none',
      },
      handlePaste: (view, event, slice) => {
        const plainText = event.clipboardData?.getData('text/plain');
        const htmlText = event.clipboardData?.getData('text/html');

        // Intercept plain text pastes that look like markdown
        if (plainText && !htmlText) {
          const markdownPattern = /^#{1,6}\s|^\*\s|^-\s|^\d+\.\s|\*\*[^*]+\*\*|\[.+\]\(.+\)|^```/m;
          if (markdownPattern.test(plainText)) {
            try {
              const html = marked.parse(plainText, { async: false }) as string;
              if (html && html !== `<p>${plainText}</p>\n`) {
                editor?.commands.insertContent(html, {
                  parseOptions: { preserveWhitespace: false },
                });
                return true;
              }
            } catch (e) {
              console.error('Markdown paste conversion failed:', e);
            }
          }
        }

        return false;
      },
    },
    onCreate: () => {
      setEditorReady(true);
    },
    onDestroy: () => {
      setEditorReady(false);
    },
    onUpdate: () => {
      // Only track changes after initial content has been loaded
      if (contentLoadedRef.current) {
        setHasUnsavedChanges(true);
        onUnsavedChangesChange?.(true);
        if (editor) {
          onContentChange?.(editor.getJSON());
        }
      }
    },
  });

  // Load the document content when component mounts
  const initialContentRef = useRef(initialContent);
  useEffect(() => {
    const loadContent = async () => {
      try {
        contentLoadedRef.current = false;
        setHasUnsavedChanges(false);
        setIsLoading(true);

        // Use pre-loaded content when available; otherwise fetch from DB
        let blockData: unknown = null;
        if (initialContentRef.current !== undefined) {
          blockData = initialContentRef.current;
        } else {
          const content = await getBlockContent(documentId);
          blockData = content?.block_data ?? null;
        }

        if (blockData) {
          try {
            const format = detectBlockContentFormat(blockData);
            let parsedContent: unknown;
            if (format === 'blocknote') {
              parsedContent = blockNoteJsonToProsemirrorJson(blockData);
            } else {
              parsedContent = normalizeProsemirrorJson(parseBlockContent(blockData));
              if (isRawMarkdownInProsemirror(parsedContent)) {
                parsedContent = convertRawMarkdownProsemirror(parsedContent);
              }
            }
            if (editor && !editor.isDestroyed) {
              editor.commands.setContent(parsedContent as Parameters<typeof editor.commands.setContent>[0]);
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
        // Mark content as loaded so future edits are tracked as unsaved changes
        contentLoadedRef.current = true;
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
      setHasUnsavedChanges(false);
      onUnsavedChangesChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor ?? null;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

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
      {!hideSaveButton && (
        <div className="mb-4 flex justify-end">
          <Button
            id="save-document-button"
            onClick={handleSave}
            disabled={isLoading || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          Loading...
        </div>
      ) : (
        editor && editorReady && !editor.isDestroyed ? (
          <div
            className={styles.editorContainer}
            data-placeholder={placeholder || 'Start writing...'}
          >
            <EditorToolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>
        ) : (
          <div className="flex justify-center items-center h-64">
            Initializing editor...
          </div>
        )
      )}
    </Card>
  );
}
