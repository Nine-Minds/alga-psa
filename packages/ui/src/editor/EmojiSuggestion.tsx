'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';

// ── Emoji search via emoji-mart ──────────────────────────────────
let emojiReady = false;
let emojiInit: Promise<void> | null = null;

async function ensureEmojiInit() {
  if (emojiReady) return;
  if (emojiInit) return emojiInit;
  emojiInit = (async () => {
    const [{ init }, data] = await Promise.all([
      import('emoji-mart'),
      import('@emoji-mart/data'),
    ]);
    await init({ data: data.default ?? data });
    emojiReady = true;
  })();
  return emojiInit;
}

export interface EmojiItem {
  id: string;
  native: string;
  name: string;
}

async function searchEmoji(query: string): Promise<EmojiItem[]> {
  await ensureEmojiInit();
  const { SearchIndex } = await import('emoji-mart');
  const results = await SearchIndex.search(query);
  if (!results) return [];
  return results.slice(0, 30).map((e: any) => ({
    id: e.id,
    native: e.skins?.[0]?.native ?? '',
    name: e.name ?? e.id,
  }));
}

// ── ProseMirror plugin that detects :query ────────────────────────
const EMOJI_PLUGIN_KEY = new PluginKey('emojiSuggestion');

export type EmojiSuggestionState = {
  active: boolean;
  query: string;
  from: number;
  to: number;
} | null;

type OnStateChange = (state: EmojiSuggestionState) => void;

function createEmojiSuggestionPlugin(onStateChange: OnStateChange) {
  return new Plugin({
    key: EMOJI_PLUGIN_KEY,
    state: {
      init: () => null as EmojiSuggestionState,
      apply(tr, prev, _oldState, newState) {
        const { selection } = newState;
        if (!selection.empty) {
          if (prev?.active) onStateChange(null);
          return null;
        }

        const pos = selection.$head;
        const textBefore = pos.parent.textBetween(0, pos.parentOffset, undefined, '\ufffc');

        // Match `:query` where query has 2+ chars, no space
        const match = textBefore.match(/:([a-zA-Z0-9_+-]{2,})$/);
        if (!match) {
          if (prev?.active) onStateChange(null);
          return null;
        }

        const query = match[1];
        const from = pos.start() + pos.parentOffset - match[0].length;
        const to = pos.start() + pos.parentOffset;
        const next: EmojiSuggestionState = { active: true, query, from, to };
        onStateChange(next);
        return next;
      },
    },
  });
}

// ── Tiptap Extension ──────────────────────────────────────────────
export interface EmojiSuggestionOptions {
  onStateChange: OnStateChange;
}

export const EmojiSuggestionExtension = Extension.create<EmojiSuggestionOptions>({
  name: 'emojiSuggestion',

  addOptions() {
    return { onStateChange: () => {} };
  },

  addProseMirrorPlugins() {
    return [createEmojiSuggestionPlugin(this.options.onStateChange)];
  },
});

// ── React popup component ─────────────────────────────────────────
interface EmojiSuggestionPopupProps {
  editor: Editor;
  suggestionState: EmojiSuggestionState;
}

export function EmojiSuggestionPopup({ editor, suggestionState }: EmojiSuggestionPopupProps) {
  const [items, setItems] = useState<EmojiItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const queryRef = useRef('');

  // Search emoji when query changes
  useEffect(() => {
    if (!suggestionState?.active) {
      setItems([]);
      setSelectedIndex(0);
      return;
    }

    const query = suggestionState.query;
    queryRef.current = query;
    setLoading(true);

    searchEmoji(query).then((results) => {
      if (queryRef.current === query) {
        setItems(results);
        setSelectedIndex(0);
        setLoading(false);
      }
    });
  }, [suggestionState?.query, suggestionState?.active]);

  // Insert emoji helper
  const insertEmoji = useCallback(
    (emoji: EmojiItem) => {
      if (!suggestionState) return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: suggestionState.from, to: suggestionState.to })
        .insertContent(emoji.native)
        .run();
    },
    [editor, suggestionState]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!suggestionState?.active || items.length === 0) return;

    const COLS = 10;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Move cursor past the colon to dismiss
        editor.commands.focus();
        // Let ProseMirror handle Escape naturally
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (items[selectedIndex]) {
          insertEmoji(items[selectedIndex]);
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.min(i + COLS, items.length - 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => Math.max(i - COLS, 0));
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [suggestionState?.active, items, selectedIndex, insertEmoji, editor]);

  // Position popup near cursor
  useEffect(() => {
    if (!popupRef.current || !suggestionState?.active) return;

    const view = editor.view;
    const coords = view.coordsAtPos(suggestionState.from);
    const editorRect = view.dom.closest('.ProseMirror')?.getBoundingClientRect();
    if (!editorRect) return;

    popupRef.current.style.left = `${coords.left - editorRect.left}px`;
    popupRef.current.style.top = `${coords.bottom - editorRect.top + 4}px`;
  }, [editor, suggestionState]);

  if (!suggestionState?.active || (items.length === 0 && !loading)) {
    return null;
  }

  return (
    <div
      ref={popupRef}
      style={{
        position: 'absolute',
        zIndex: 50,
        background: 'var(--bn-colors-menu-background, #fff)',
        border: '1px solid var(--bn-colors-menu-border, #e2e8f0)',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(10, 1fr)',
        gap: '2px',
        maxWidth: '340px',
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          role="option"
          aria-selected={i === selectedIndex}
          title={item.name}
          onClick={() => insertEmoji(item)}
          style={{
            cursor: 'pointer',
            fontSize: '22px',
            lineHeight: '1',
            padding: '4px',
            borderRadius: '4px',
            textAlign: 'center',
            background: i === selectedIndex ? 'var(--bn-colors-menu-hover, #edf2f7)' : 'transparent',
          }}
        >
          {item.native}
        </div>
      ))}
    </div>
  );
}
