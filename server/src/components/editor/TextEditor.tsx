'use client';

import { useEffect, useMemo, useState, MutableRefObject } from 'react';
import { Block, BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { BlockNoteView, lightDefaultTheme } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { getBlockContent } from '../../lib/actions/document-actions/documentBlockContentActions';
import { Card } from '../ui/Card';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ContainerComponent, FormFieldComponent } from '../../types/ui-reflection/types';

interface TextEditorProps {
  id?: string; // Made optional to maintain backward compatibility
  roomName?: string;
  initialContent?: string | Block[];
  onContentChange?: (blocks: Block[]) => void;
  children?: React.ReactNode;
  editorRef?: MutableRefObject<BlockNoteEditor | null>;
  documentId?: string;
}

// Default block for empty content using proper BlockNote types
const DEFAULT_BLOCK: PartialBlock[] = [{
  type: "paragraph",
  content: [{
    type: "text",
    text: "",
    styles: {}
  }],
  props: {
    textAlignment: "left",
    backgroundColor: "default",
    textColor: "default"
  }
}];

export default function TextEditor({ 
  id = 'text-editor',
  initialContent: propInitialContent,
  onContentChange,
  children,
  editorRef,
  documentId
}: TextEditorProps) {
  const [error, setError] = useState<string | null>(null);
  const [initialContent, setInitialContent] = useState<PartialBlock[] | undefined | 'loading'>('loading');
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<BlockNoteEditor | undefined>(undefined);

  // Register all components with UI reflection system
  const { automationIdProps: errorProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `${id}-error`,
    type: 'container',
    label: 'Error Message'
  });

  const { automationIdProps: loadingProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `${id}-loading`,
    type: 'container',
    label: 'Loading State'
  });

  const { automationIdProps: containerProps } = useAutomationIdAndRegister<ContainerComponent>({
    id: `${id}-container`,
    type: 'container',
    label: 'Editor Container'
  });

  const { automationIdProps: editorProps } = useAutomationIdAndRegister<FormFieldComponent>({
    id: `${id}-editor`,
    type: 'formField',
    fieldType: 'textField',
    label: 'Rich Text Editor'
  });

  // Load document content if documentId is provided
  useEffect(() => {
    const loadContent = async () => {
      try {
        if (documentId) {
          const content = await getBlockContent(documentId);
          if (content?.block_data) {
            try {
              // Parse the JSON string into blocks if it's a string
              const parsed = typeof content.block_data === 'string' 
                ? JSON.parse(content.block_data)
                : content.block_data;
              // If parsed is an object with a blocks property, use that
              const blocks = parsed.blocks || parsed;
              setInitialContent(Array.isArray(blocks) && blocks.length > 0 ? blocks : DEFAULT_BLOCK);
            } catch (parseError) {
              console.error('Error parsing block data:', parseError);
              setError('Failed to parse document content');
              setInitialContent(DEFAULT_BLOCK);
            }
          } else {
            setInitialContent(DEFAULT_BLOCK);
          }
        } else if (propInitialContent) {
          // Handle initial content based on its type
          if (typeof propInitialContent === 'string') {
            try {
              // Try to parse if it's a JSON string
              const parsed = JSON.parse(propInitialContent);
              // If parsed is an object with a blocks property, use that
              const blocks = parsed.blocks || parsed;
              setInitialContent(Array.isArray(blocks) && blocks.length > 0 ? blocks : DEFAULT_BLOCK);
            } catch {
              // If parsing fails, create a default block with the string content
              setInitialContent([{
                type: "paragraph",
                content: [{
                  type: "text",
                  text: propInitialContent,
                  styles: {}
                }],
                props: {
                  textAlignment: "left",
                  backgroundColor: "default",
                  textColor: "default"
                }
              }]);
            }
          } else {
            // If it's already blocks, use directly or fallback to default
            setInitialContent(propInitialContent.length > 0 ? propInitialContent : DEFAULT_BLOCK);
          }
        } else {
          // No content provided, start with default block
          setInitialContent(DEFAULT_BLOCK);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load document content');
        setInitialContent(DEFAULT_BLOCK);
      }
    };

    loadContent();
  }, [documentId, propInitialContent]);

  useEffect(() => {
    // Use setTimeout to ensure state updates after render
    setTimeout(() => {
      if (initialContent === 'loading') {
        return undefined;
      }        
      const newEditor = BlockNoteEditor.create({ 
        initialContent: initialContent || DEFAULT_BLOCK
      });
      
      setEditor(newEditor);
      setLoading(false);
    }, 10);
  }, [initialContent]);

  // Set editor reference if provided
  useEffect(() => {
    if (editorRef && editor) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

  const content = useMemo(() => {
    if (error) {
      return (
        <ReflectionContainer id={id} label="Text Editor Error">
          <Card {...errorProps} className="p-4">
            <div className="text-red-500">Error: {error}</div>
          </Card>
        </ReflectionContainer>
      );
    }

    if (editor === undefined || loading) {
      return (
        <ReflectionContainer id={id} label="Text Editor Loading">
          <Card {...loadingProps} className="p-4">
            <div className="flex justify-center items-center h-64">
              Loading...
            </div>
          </Card>
        </ReflectionContainer>
      );
    }

    return (
      <ReflectionContainer id={id} label="Text Editor">
        <Card {...containerProps} className="p-4">
          {children}
          
          <div {...editorProps}>
            <BlockNoteView 
              editor={editor}
              theme={{
                ...lightDefaultTheme,
                colors: {
                  ...lightDefaultTheme.colors,
                  editor: {
                    text: '#000000',
                    background: '#ffffff'
                  }
                }
              }}
              onChange={() => {
                if (onContentChange) {
                  // Get the current blocks and pass them back
                  const blocks = editor.document;
                  // Let Documents.tsx handle the wrapping with formatBlocksForStorage
                  onContentChange(blocks);
                }
              }}
            />
          </div>
        </Card>
      </ReflectionContainer>
    );
  }, [error, editor, loading, children, errorProps, loadingProps, containerProps, editorProps, id, onContentChange]);

  return content;
}
