'use client';

import { useEffect, useState, MutableRefObject } from 'react';
import { useTheme } from 'next-themes';
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
const DEBUG = false;

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
  placeholder?: string;
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
  placeholder,
}: TextEditorProps) {
  const { resolvedTheme } = useTheme();
  const blockNoteTheme = resolvedTheme === 'dark' ? 'dark' : 'light';
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
    placeholders: {
      default: placeholder || "Start typing...",
    },
    domAttributes: {
      editor: {
        class: 'block-note-editor',
        contenteditable: 'true'
      }
    },
    _tiptapOptions: {
      editorProps: {
        handlePaste: (view, event, slice) => {
          // Handle pasting into empty blocks
          const { state, dispatch } = view;
          const { selection } = state;
          const $pos = selection.$anchor;
          const parent = $pos.parent;

          if (parent.content.size === 0 && slice.content.size > 0) {
            try {
              const tr = state.tr;
              tr.replace(selection.from, selection.to, slice);
              dispatch(tr);
              return true;
            } catch (error) {
              console.error('Paste error:', error);
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
    try {
      const users = await (searchMentions ? searchMentions(query) : Promise.resolve([]));

      const items: DefaultReactSuggestionItem[] = [];

      // Add @everyone option if it matches the query
      if ('everyone'.includes(query.toLowerCase()) || query === '') {
        items.push({
          title: 'Everyone',
          subtext: '@everyone - Mention all internal users',
          onItemClick: () => {
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

      return items;
    } catch (error) {
      console.error('[TextEditor] Error fetching mention users:', error);
      return [];
    }
  };

  // Intercept paste events to detect and convert markdown
  useEffect(() => {
    if (!editor) return;

    const domElement = editor.domElement;
    if (!domElement) return;

    const markdownPattern = /^#{1,6}\s|^\*\s|^-\s|^\d+\.\s|\*\*[^*]+\*\*|\[.+\]\(.+\)|^```/m;

    const handlePaste = (event: ClipboardEvent) => {
      const plainText = event.clipboardData?.getData('text/plain');
      if (!plainText || !markdownPattern.test(plainText)) return;

      // Prevent default paste — we'll handle it
      event.preventDefault();
      event.stopPropagation();

      (async () => {
        try {
          const blocks = await editor.tryParseMarkdownToBlocks(plainText);
          if (blocks && blocks.length > 0) {
            const currentBlock = editor.getTextCursorPosition().block;
            editor.replaceBlocks([currentBlock.id], blocks);
          }
        } catch (e) {
          // Fallback: insert as plain text
          editor.insertInlineContent([{ type: "text", text: plainText, styles: {} }]);
        }
      })();
    };

    domElement.addEventListener('paste', handlePaste, { capture: true });
    return () => {
      domElement.removeEventListener('paste', handlePaste, { capture: true });
    };
  }, [editor]);

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

    const cleanup = editor.onEditorContentChange(handleChange);
    return cleanup;
  }, [editor, onContentChange]);

  return (
    <div className="w-full h-full min-w-0">
      {children}
      <div
        className="min-h-[100px] h-full w-full editor-paper border border-[#e8e4de] dark:border-[rgb(var(--color-border-200))] rounded-lg p-4 overflow-auto min-w-0"
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
          theme={blockNoteTheme}
          className="w-full min-w-0 [&_.ProseMirror]:break-words [&_.ProseMirror]:max-w-full [&_.ProseMirror]:min-w-0 [&_.bn-block-outer_[data-drag-handle]]:!hidden [&_[draggable='true']]:!hidden [&_.ProseMirror_a]:text-[rgb(var(--badge-info-text))] [&_.ProseMirror_a]:font-medium [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:decoration-[rgb(var(--badge-info-text)/0.4)] [&_.ProseMirror_a]:underline-offset-2 [&_.ProseMirror_a:hover]:decoration-[rgb(var(--badge-info-text))]"
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
