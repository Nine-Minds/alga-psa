'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { Editor } from '@tiptap/react';

// ── Types ────────────────────────────────────────────────────────
export interface MentionUser {
  user_id: string;
  display_name: string;
  username?: string | null;
  email: string;
}

export type MentionSuggestionState = {
  active: boolean;
  query: string;
  from: number;
  to: number;
} | null;

type OnStateChange = (state: MentionSuggestionState) => void;
type SearchMentionsFn = (query: string) => Promise<MentionUser[]>;

// ── ProseMirror plugin that detects @query ───────────────────────
const MENTION_PLUGIN_KEY = new PluginKey('mentionSuggestion');

function createMentionSuggestionPlugin(onStateChange: OnStateChange) {
  return new Plugin({
    key: MENTION_PLUGIN_KEY,
    state: {
      init: () => null as MentionSuggestionState,
      apply(_tr, prev, _oldState, newState) {
        const { selection } = newState;
        if (!selection.empty) {
          if (prev?.active) onStateChange(null);
          return null;
        }

        const pos = selection.$head;
        const textBefore = pos.parent.textBetween(0, pos.parentOffset, undefined, '\ufffc');

        // Match @query — trigger on @ at start of text or after a space
        const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_ ]{0,30})$/);
        if (!match) {
          if (prev?.active) onStateChange(null);
          return null;
        }

        const query = match[1];
        // Calculate the position of @ (account for leading space if present)
        const matchStart = match[0].startsWith(' ') ? match.index! + 1 : match.index!;
        const from = pos.start() + matchStart;
        const to = pos.start() + pos.parentOffset;
        const next: MentionSuggestionState = { active: true, query, from, to };
        onStateChange(next);
        return next;
      },
    },
  });
}

// ── Mention Node (inline, read-only badge) ───────────────────────
function MentionNodeView(props: any) {
  const { userId, username, displayName, status } = props.node.attrs;
  const isAi = userId === '@ai-assistant' || userId === '@ai-assistant-done';
  const isDone = status === 'done' || userId === '@ai-assistant-done';
  const displayText = isAi ? '@Alga AI' : (username ? `@${username}` : `@${displayName}`);

  const baseClass = isAi
    ? isDone
      ? 'inline-flex items-center px-1 py-0.5 rounded bg-purple-100 text-purple-400 font-medium cursor-default opacity-60'
      : 'inline-flex items-center px-1 py-0.5 rounded bg-purple-100 text-purple-700 font-medium cursor-pointer hover:opacity-80'
    : 'inline-flex items-center px-1 py-0.5 rounded bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))] font-medium cursor-pointer hover:opacity-80';

  return (
    <NodeViewWrapper as="span" className="mention-inline">
      <span
        className={baseClass}
        data-user-id={userId}
        title={isAi ? 'Alga AI Assistant' : `${displayName} (${username || 'no username'})`}
      >
        {displayText}
      </span>
    </NodeViewWrapper>
  );
}

export const MentionNode = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      userId: { default: '' },
      username: { default: '' },
      displayName: { default: 'Unknown' },
      status: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const { userId, username, displayName, status } = HTMLAttributes;
    const isAi = userId === '@ai-assistant' || userId === '@ai-assistant-done';
    const isDone = status === 'done' || userId === '@ai-assistant-done';
    const displayText = isAi ? '@Alga AI' : (username ? `@${username}` : `@${displayName}`);
    const className = isAi
      ? isDone
        ? 'inline-flex items-center px-1 py-0.5 rounded bg-purple-100 text-purple-400 font-medium opacity-60'
        : 'inline-flex items-center px-1 py-0.5 rounded bg-purple-100 text-purple-700 font-medium'
      : 'inline-flex items-center px-1 py-0.5 rounded bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))] font-medium';
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-mention': '',
        'data-user-id': userId,
        class: className,
      }),
      displayText,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView);
  },
});

// ── Tiptap Extension (suggestion detection) ──────────────────────
export interface MentionSuggestionOptions {
  onStateChange: OnStateChange;
}

export const MentionSuggestionExtension = Extension.create<MentionSuggestionOptions>({
  name: 'mentionSuggestion',

  addOptions() {
    return { onStateChange: () => {} };
  },

  addProseMirrorPlugins() {
    return [createMentionSuggestionPlugin(this.options.onStateChange)];
  },
});

// ── AI mention trigger keywords ─────────────────────────────────
const AI_TRIGGERS = ['ai', 'alga', 'aialga', 'algaai', 'assistant', 'alga ai', 'ai alga'];

// ── React popup component ────────────────────────────────────────
interface MentionSuggestionPopupProps {
  editor: Editor;
  suggestionState: MentionSuggestionState;
  searchMentions: SearchMentionsFn;
  aiAssistantEnabled?: boolean;
}

export function MentionSuggestionPopup({
  editor,
  suggestionState,
  searchMentions,
  aiAssistantEnabled = false,
}: MentionSuggestionPopupProps) {
  const [items, setItems] = useState<MentionUser[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const queryRef = useRef('');

  // Search users when query changes
  useEffect(() => {
    if (!suggestionState?.active) {
      setItems([]);
      setSelectedIndex(0);
      return;
    }

    const query = suggestionState.query;
    queryRef.current = query;
    setLoading(true);

    // Build results: @everyone + search results
    const fetchResults = async () => {
      try {
        const users = await searchMentions(query);
        if (queryRef.current !== query) return;

        const results: MentionUser[] = [];

        // Add @everyone if it matches
        if ('everyone'.includes(query.toLowerCase()) || query === '') {
          results.push({
            user_id: '@everyone',
            display_name: 'Everyone',
            username: 'everyone',
            email: '',
          });
        }

        // Add Alga AI if enabled and query matches
        if (aiAssistantEnabled) {
          const queryLower = query.toLowerCase();
          if (query === '' || AI_TRIGGERS.some((t) => t.includes(queryLower))) {
            results.push({
              user_id: '@ai-assistant',
              display_name: 'Alga AI',
              username: 'alga',
              email: '',
            });
          }
        }

        results.push(...users);
        setItems(results);
        setSelectedIndex(0);
      } catch (error) {
        console.error('[MentionSuggestion] Search failed:', error);
        setItems([]);
      } finally {
        if (queryRef.current === query) {
          setLoading(false);
        }
      }
    };

    void fetchResults();
  }, [suggestionState?.query, suggestionState?.active, searchMentions, aiAssistantEnabled]);

  // Insert mention helper
  const insertMention = useCallback(
    (user: MentionUser) => {
      if (!suggestionState) return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: suggestionState.from, to: suggestionState.to })
        .insertContent([
          {
            type: 'mention',
            attrs: {
              userId: user.user_id,
              username: user.username ?? '',
              displayName: user.display_name,
            },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
    [editor, suggestionState]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!suggestionState?.active || items.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        editor.commands.focus();
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (items[selectedIndex]) {
          insertMention(items[selectedIndex]);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
    };

    const target = editor.view.dom;
    target.addEventListener('keydown', handleKeyDown, true);
    return () => target.removeEventListener('keydown', handleKeyDown, true);
  }, [suggestionState?.active, items, selectedIndex, insertMention, editor]);

  // Position popup near cursor (fixed so it escapes overflow containers)
  useEffect(() => {
    if (!popupRef.current || !suggestionState?.active) return;

    const view = editor.view;
    const coords = view.coordsAtPos(suggestionState.from);

    popupRef.current.style.left = `${coords.left}px`;
    popupRef.current.style.top = `${coords.bottom + 4}px`;
  }, [editor, suggestionState]);

  if (!suggestionState?.active || (items.length === 0 && !loading)) {
    return null;
  }

  return createPortal(
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        zIndex: 9999,
        background: 'rgb(var(--color-card, 255 255 255))',
        border: '1px solid rgb(var(--color-border-200, 226 232 240))',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '4px',
        minWidth: '200px',
        maxWidth: '300px',
        maxHeight: '240px',
        overflowY: 'auto',
      }}
    >
      {loading && items.length === 0 ? (
        <div
          style={{
            padding: '8px 12px',
            fontSize: '13px',
            color: 'rgb(var(--color-text-400, 113 128 150))',
          }}
        >
          Loading...
        </div>
      ) : (
        items.map((user, i) => (
          <div
            key={user.user_id}
            role="option"
            aria-selected={i === selectedIndex}
            onClick={() => insertMention(user)}
            style={{
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: '4px',
              fontSize: '13px',
              color: 'rgb(var(--color-text-700, 45 55 72))',
              background:
                i === selectedIndex
                  ? 'rgb(var(--color-border-100, 237 242 247))'
                  : 'transparent',
              display: 'flex',
              flexDirection: 'column',
              gap: '1px',
            }}
          >
            <span style={{ fontWeight: 500 }}>{user.display_name}</span>
            {user.username && (
              <span
                style={{
                  fontSize: '11px',
                  color: 'rgb(var(--color-text-400, 113 128 150))',
                  opacity: 0.7,
                }}
              >
                @{user.username}
              </span>
            )}
          </div>
        ))
      )}
    </div>,
    document.body
  );
}
