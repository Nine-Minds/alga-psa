'use client';

import { useEffect, useState, useRef, MutableRefObject } from 'react';
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

// Debug flag
const DEBUG = true;

export interface MentionUser {
  user_id: string;
  display_name: string;
  username?: string | null;
  email: string;
}

interface TextEditorProps {
  id?: string;
  roomName?: string;
  initialContent?: string | PartialBlock[];
  onContentChange?: (blocks: PartialBlock[]) => void;
  children?: React.ReactNode;
  editorRef?: MutableRefObject<BlockNoteEditor<any, any, any> | null>;
  documentId?: string;
  searchMentions?: (query: string) => Promise<MentionUser[]>;
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
  documentId,
  searchMentions,
}: TextEditorProps) {
  // Track mounted state to prevent operations on unmounted component
  const isMountedRef = useRef(true);
  // Delay rendering BlockNoteView to avoid initialization race conditions
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    // Small delay to ensure React has fully mounted the component
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        setIsReady(true);
      }
    }, 0);
    return () => {
      isMountedRef.current = false;
      clearTimeout(timer);
    };
  }, []);

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
    },
    _tiptapOptions: {
      editorProps: {
        handlePaste: (view, event, slice) => {
          const { state, dispatch } = view;
          const { selection } = state;

          // Check if we're pasting into an empty block
          const $pos = selection.$anchor;
          const parent = $pos.parent;

          // If the current block is empty and we have slice content
          if (parent.content.size === 0 && slice.content.size > 0) {
            try {
              const tr = state.tr;

              // Use the correct ProseMirror replace method
              tr.replace(selection.from, selection.to, slice);

              dispatch(tr);
              return true;
            } catch (error) {
              console.error('Paste error:', error);
              // Fall back to default behavior if our custom handling fails
              return false;
            }
          }

          // For non-empty blocks, let BlockNote handle it normally
          return false;
        }
      }
    }
  });

  // Get mention menu items based on search query
  const getMentionMenuItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    console.log('[TextEditor] getMentionMenuItems called with query:', query);

    try {
      const users = await (searchMentions ? searchMentions(query) : Promise.resolve([]));
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
                username: user.username ?? '',
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

  // Update editorRef when editor is created and ready
  useEffect(() => {
    if (editorRef && isMountedRef.current && isReady) {
      editorRef.current = editor;
    }

    // Cleanup editor when component unmounts
    return () => {
      if (editorRef) {
        editorRef.current = null;
      }
    };
  }, [editor, editorRef, isReady]);

  // Handle content changes - only when editor is ready
  useEffect(() => {
    if (!editor || !isReady) return;

    const handleChange = () => {
      // Don't process changes if component is unmounting
      if (!isMountedRef.current) return;

      if (DEBUG) {
        console.log('TextEditor: Editor content changed:', editor.topLevelBlocks);
      }
      if (onContentChange) {
        onContentChange(editor.topLevelBlocks as any);
      }
    };

    const cleanup = editor.onEditorContentChange(handleChange);
    return cleanup;
  }, [editor, onContentChange, isReady]);

  // Don't render BlockNoteView until ready to avoid initialization race conditions
  if (!isReady) {
    return (
      <div className="w-full h-full min-w-0">
        {children}
        <div className="min-h-[100px] h-full w-full bg-white border border-gray-200 rounded-lg p-4 overflow-auto min-w-0">
          {/* Placeholder while editor initializes */}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-w-0">
      {children}
      <div
        className="min-h-[100px] h-full w-full bg-white border border-gray-200 rounded-lg p-4 overflow-auto min-w-0"
        onDragStart={(e) => {
          // Only prevent drag from elements with draggable="true" attribute (the drag handle)
          const target = e.target as HTMLElement;
          if (target.getAttribute('draggable') === 'true') {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <BlockNoteView
          editor={editor}
          theme="light"
          className="w-full min-w-0 [&_.ProseMirror]:break-words [&_.ProseMirror]:max-w-full [&_.ProseMirror]:min-w-0 [&_.bn-block-outer_[data-drag-handle]]:!hidden [&_[draggable='true']]:!hidden"
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
