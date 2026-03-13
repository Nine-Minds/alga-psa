'use client';

import { useEffect, useRef, MutableRefObject } from 'react';
import { useTheme } from 'next-themes';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  DefaultReactSuggestionItem,
  GridSuggestionMenuController,
  DefaultReactGridSuggestionItem,
  GridSuggestionMenuProps,
} from "@blocknote/react";
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import './blocknote-styles.css';
import {
  BlockNoteEditor,
  PartialBlock,
  BlockNoteSchema,
  defaultInlineContentSpecs,
} from '@blocknote/core';
import { TextSelection } from '@tiptap/pm/state';
import { Mention } from './Mention';
import { Emoticon } from './EmoticonExtension';

// Debug flag
const DEBUG = false;

// Custom emoji grid that silently hides when no items match, instead of
// showing "No items found" (prevents flash after emoticon conversion).
function EmojiGrid(props: GridSuggestionMenuProps<DefaultReactGridSuggestionItem>) {
  const { items, selectedIndex, onItemClick, columns, loadingState } = props;

  if (items.length === 0 && loadingState === 'loaded') {
    return null;
  }

  if (loadingState === 'loading-initial' || loadingState === 'loading') {
    return <div className="bn-grid-suggestion-menu-loader">Loading...</div>;
  }

  return (
    <div
      id="bn-grid-suggestion-menu"
      className="bn-grid-suggestion-menu"
      role="grid"
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          role="option"
          aria-selected={i === selectedIndex}
          className={`bn-grid-suggestion-menu-item${i === selectedIndex ? ' bn-grid-suggestion-menu-item-selected' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => onItemClick?.(item)}
        >
          {item.icon}
        </div>
      ))}
    </div>
  );
}

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
  uploadFile?: (file: File, blockId?: string) => Promise<string | Record<string, any>>;
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

// Pattern for detecting markdown in pasted text
const markdownPattern = /^#{1,6}\s|^\*\s|^-\s|^\d+\.\s|\*\*[^*]+\*\*|\[.+\]\(.+\)|^```/m;

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
  uploadFile,
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

    const mediaBlockTypes = new Set(['image', 'video', 'audio', 'file']);

    // Type guard for text content
    const isTextContent = (content: any): content is { type: "text"; text: string; styles: {} } => {
      return content?.type === "text" && typeof content?.text === "string";
    };

    // Remove empty trailing blocks
    let i = blocks.length - 1;
    while (i >= 0) {
      const block = blocks[i];
      const hasContent = (block: PartialBlock): boolean => {
        // Media blocks typically store payload in props and should not be
        // trimmed as "empty" when opening edit mode.
        if (!block.content) {
          if (typeof block.type === 'string' && mediaBlockTypes.has(block.type)) {
            const props = block.props as Record<string, unknown> | undefined;
            return Boolean(props?.url || props?.name);
          }
          return false;
        }
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

  // Ref for accessing editor instance from ProseMirror handlers
  const bnEditorRef = useRef<BlockNoteEditor<any, any, any> | null>(null);

  // Create editor instance with custom schema and initial content
  const editor = useCreateBlockNote({
    schema,
    initialContent,
    uploadFile,
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
      extensions: [Emoticon],
      editorProps: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            // Fix: clicking in empty space to the left/right of text places
            // cursor at the wrong position. Intercept at mousedown to prevent
            // flash, and manually handle drag-to-select from the corrected anchor.
            if (event.detail > 1 || event.shiftKey || event.button !== 0) return false;

            const posInfo = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!posInfo) return false;

            const { state } = view;
            const $pos = state.doc.resolve(posInfo.pos);

            if (!$pos.parent.isTextblock || $pos.parent.content.size === 0) return false;

            const blockStart = $pos.start();
            if (posInfo.pos !== blockStart) return false;

            const startCoords = view.coordsAtPos(blockStart);
            const endCoords = view.coordsAtPos($pos.end());

            let anchorPos: number | null = null;
            if (event.clientX > endCoords.left) {
              anchorPos = $pos.end(); // right of text → end
            } else if (event.clientX < startCoords.left) {
              anchorPos = blockStart; // left of text → start
            }

            if (anchorPos === null) return false;

            event.preventDefault();
            view.dispatch(
              state.tr.setSelection(TextSelection.create(state.doc, anchorPos))
            );
            view.focus();

            // Handle drag-to-select from the corrected anchor
            const onMouseMove = (e: MouseEvent) => {
              if (view.isDestroyed) return;
              const movePos = view.posAtCoords({ left: e.clientX, top: e.clientY });
              if (movePos) {
                const sel = TextSelection.create(view.state.doc, anchorPos!, movePos.pos);
                view.dispatch(view.state.tr.setSelection(sel));
              }
            };

            const onMouseUp = () => {
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            return true;
          },
        },
        handlePaste: (view, event, slice) => {
          // Detect markdown in pasted plain text and convert to rich blocks
          const plainText = event.clipboardData?.getData('text/plain');
          if (plainText && markdownPattern.test(plainText) && bnEditorRef.current) {
            event.preventDefault();
            const ed = bnEditorRef.current;
            (async () => {
              try {
                const blocks = await ed.tryParseMarkdownToBlocks(plainText);
                if (blocks && blocks.length > 0) {
                  const currentBlock = ed.getTextCursorPosition().block;
                  ed.replaceBlocks([currentBlock.id], blocks);
                }
              } catch (e) {
                ed.insertInlineContent([{ type: "text", text: plainText, styles: {} }]);
              }
            })();
            return true;
          }

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

  bnEditorRef.current = editor;

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
        console.log('TextEditor: Editor content changed:', editor.document);
      }
      if (onContentChange) {
        onContentChange(editor.document as any);
      }
    };

    const cleanup = editor.onChange(handleChange);
    return cleanup;
  }, [editor, onContentChange]);

  return (
    <div className="w-full h-full min-w-0">
      {children}
      <div
        className="min-h-[100px] h-full w-full editor-paper border border-[#e5e7eb] dark:border-[rgb(var(--color-border-200))] rounded-lg p-4 overflow-auto min-w-0"
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
          emojiPicker={false}
          className="w-full min-w-0 [&_.ProseMirror]:break-words [&_.ProseMirror]:max-w-full [&_.ProseMirror]:min-w-0 [&_.ProseMirror_a]:text-[rgb(var(--badge-info-text))] [&_.ProseMirror_a]:font-medium [&_.ProseMirror_a]:underline [&_.ProseMirror_a]:decoration-[rgb(var(--badge-info-text)/0.4)] [&_.ProseMirror_a]:underline-offset-2 [&_.ProseMirror_a:hover]:decoration-[rgb(var(--badge-info-text))]"
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
          <GridSuggestionMenuController
            triggerCharacter=":"
            columns={10}
            minQueryLength={2}
            gridSuggestionMenuComponent={EmojiGrid}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
