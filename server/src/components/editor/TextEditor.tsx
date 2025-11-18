'use client';

import { useEffect, useState, MutableRefObject } from 'react';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import {
  BlockNoteEditor,
  PartialBlock,
  BlockNoteSchema,
  defaultInlineContentSpecs,
  filterSuggestionItems,
} from '@blocknote/core';
import { Mention } from './Mention';
import { searchUsersForMentions, MentionUser } from '../../lib/actions/user-actions/searchUsersForMentions';

// Debug flag
const DEBUG = true;

interface TextEditorProps {
  id?: string;
  roomName?: string;
  initialContent?: string | PartialBlock[];
  onContentChange?: (blocks: PartialBlock[]) => void;
  children?: React.ReactNode;
  editorRef?: MutableRefObject<BlockNoteEditor<any, any, any> | null>;
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

// Create custom schema with mention support
const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: Mention,
  },
});

export default function TextEditor({ 
  id = 'text-editor',
  roomName,
  initialContent: propInitialContent,
  onContentChange,
  children,
  editorRef,
  documentId
}: TextEditorProps) {
  // Parse initial content and remove empty trailing blocks
  const initialContent = (() => {
    let blocks: PartialBlock[] = [];
    
    if (!propInitialContent) return DEFAULT_BLOCK;
    
    if (Array.isArray(propInitialContent)) {
      blocks = propInitialContent;
    } else {
      try {
        const parsed = JSON.parse(propInitialContent);
        if (Array.isArray(parsed) && parsed.length > 0) {
          blocks = parsed;
        }
      } catch {
        // If string can't be parsed as JSON, create a text block with it
        blocks = [{
          type: "paragraph" as const,
          props: {
            textAlignment: "left" as const,
            backgroundColor: "default" as const,
            textColor: "default" as const
          },
          content: [{
            type: "text" as const,
            text: propInitialContent,
            styles: {}
          }]
        }];
      }
    }

    // If we still have no blocks, return default
    if (blocks.length === 0) {
      return DEFAULT_BLOCK;
    }

    // Type guard for text content
    const isTextContent = (content: any): content is { type: "text"; text: string; styles: {} } => {
      return content?.type === "text";
    };

    // Remove empty trailing blocks
    let i = blocks.length - 1;
    while (i >= 0) {
      const block = blocks[i];
      const hasContent = (block: PartialBlock): boolean => {
        if (!block.content) return false;
        if (Array.isArray(block.content)) {
          return block.content.some(item => {
            if (isTextContent(item)) {
              return item.text.trim() !== "";
            }
            return true; // Keep non-text content
          });
        }
        return false;
      };
      
      if (hasContent(block)) break;
      i--;
    }

    // If all blocks were empty (i is -1), return DEFAULT_BLOCK
    // Otherwise return the non-empty blocks
    return i >= 0 ? blocks.slice(0, i + 1) : DEFAULT_BLOCK;
  })();

  // Create editor instance with custom schema and initial content
  const editor = useCreateBlockNote({
    schema,
    initialContent,
    domAttributes: {
      editor: {
        class: 'block-note-editor',
        contenteditable: 'true'
      }
    }
  });

  // Get mention menu items based on search query
  const getMentionMenuItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    console.log('[TextEditor] getMentionMenuItems called with query:', query);

    try {
      const users = await searchUsersForMentions(query);
      console.log('[TextEditor] Received users:', users.length);

      const items: DefaultReactSuggestionItem[] = [];

      // Add @everyone option if it matches the query
      if ('everyone'.includes(query.toLowerCase()) || query === '') {
        items.push({
          title: 'Everyone',
          subtext: '@everyone - Mention all internal users',
          onItemClick: () => {
            console.log('[TextEditor] @everyone selected');
            editor.insertInlineContent([
              {
                type: "mention",
                props: {
                  userId: '@everyone',
                  username: 'everyone',
                  displayName: 'Everyone'
                }
              },
              " ", // Add space after mention
            ]);
          },
        });
      }

      // Add regular user items
      items.push(...users.map((user) => ({
        title: user.display_name,
        subtext: user.username ? `@${user.username}` : user.email,
        onItemClick: () => {
          console.log('[TextEditor] User selected:', user);
          editor.insertInlineContent([
            {
              type: "mention",
              props: {
                userId: user.user_id,
                username: user.username,
                displayName: user.display_name
              }
            },
            " ", // Add space after mention
          ]);
        },
      })));

      console.log('[TextEditor] Returning items:', items.length);
      return items;
    } catch (error) {
      console.error('[TextEditor] Error fetching mention users:', error);
      return [];
    }
  };

  // Update editorRef when editor is created
  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor;
    }
    
    // Cleanup editorRef when component unmounts
    return () => {
      if (editorRef) {
        editorRef.current = null;
      }
    };
  }, [editor, editorRef]);

  // Handle content changes
  useEffect(() => {
    if (!editor) return;

    const handleChange = () => {
      if (DEBUG) {
        console.log('TextEditor: Editor content changed:', editor.topLevelBlocks);
      }
      if (onContentChange) {
        onContentChange(editor.topLevelBlocks as any);
      }
    };

    editor.onEditorContentChange(handleChange);
  }, [editor, onContentChange]);

  return (
    <div className="w-full h-full min-w-0">
      {children}
      <div className="min-h-[100px] h-full w-full bg-white border border-gray-200 rounded-lg p-4 overflow-auto min-w-0">
        <BlockNoteView
          editor={editor}
          theme="light"
          className="w-full min-w-0 [&_.ProseMirror]:break-words [&_.ProseMirror]:max-w-full [&_.ProseMirror]:min-w-0"
          editable={true}
          style={{
            overflowWrap: 'break-word',
            minWidth: 0
          }}
        >
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={async (query) => getMentionMenuItems(query)}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
