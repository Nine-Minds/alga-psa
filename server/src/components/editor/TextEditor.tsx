'use client';

import { useEffect, useState, MutableRefObject } from 'react';
import {
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { 
  BlockNoteEditor, 
  PartialBlock,
} from '@blocknote/core';

// Debug flag
const DEBUG = true;

interface TextEditorProps {
  id?: string;
  roomName?: string;
  initialContent?: string | PartialBlock[];
  onContentChange?: (blocks: PartialBlock[]) => void;
  children?: React.ReactNode;
  editorRef?: MutableRefObject<BlockNoteEditor | null>;
  documentId?: string;
}

export const DEFAULT_BLOCK: PartialBlock[] = [{
  type: "paragraph",
  props: {
    textAlignment: "left",
    backgroundColor: "default",
    textColor: "default"
  },
  content: [{
    type: "text",
    text: "",
    styles: {}
  }]
}];

export default function TextEditor({ 
  id = 'text-editor',
  roomName,
  initialContent: propInitialContent,
  onContentChange,
  children,
  editorRef,
  documentId
}: TextEditorProps) {
  // Parse initial content
  const initialContent = (() => {
    if (!propInitialContent) return DEFAULT_BLOCK;
    
    if (Array.isArray(propInitialContent)) {
      return propInitialContent;
    }

    try {
      const parsed = JSON.parse(propInitialContent);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // If string can't be parsed as JSON, create a text block with it
      return [{
        type: "paragraph",
        props: {
          textAlignment: "left",
          backgroundColor: "default",
          textColor: "default"
        },
        content: [{
          type: "text",
          text: propInitialContent,
          styles: {}
        }]
      }];
    }

    return DEFAULT_BLOCK;
  })();

  // Create editor instance with initial content
  const editor = useCreateBlockNote({
    initialContent,
  });

  // Update editorRef when editor is created
  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor;
    }
  }, [editor, editorRef]);

  // Handle content changes
  useEffect(() => {
    if (!editor) return;

    const handleChange = () => {
      if (DEBUG) {
        console.log('TextEditor: Editor content changed:', editor.topLevelBlocks);
      }
      if (onContentChange) {
        onContentChange(editor.topLevelBlocks);
      }
    };

    editor.onEditorContentChange(handleChange);
    return () => {};
  }, [editor, onContentChange]);

  return (
    <div className="w-full h-full">
      {children}
      <div className="min-h-[100px] h-full w-full bg-white border border-gray-200 rounded-lg p-4 overflow-auto">
        <BlockNoteView
          editor={editor}
          theme="light"
          className="w-full"
        />
      </div>
    </div>
  );
}
