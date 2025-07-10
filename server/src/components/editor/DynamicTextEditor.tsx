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

// Re-export the interface and constants for compatibility
export interface TextEditorProps {
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

// Import and re-export the actual TextEditor component
import TextEditor from './TextEditor';

const DynamicTextEditor: React.FC<TextEditorProps> = (props) => {
  return <TextEditor {...props} />;
};

export default DynamicTextEditor;