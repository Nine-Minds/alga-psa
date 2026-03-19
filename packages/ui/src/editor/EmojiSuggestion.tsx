'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { ensureEmojiInit, searchEmoji } from '../lib/emojiSearch';
import type { EmojiItem } from '../lib/emojiSearch';

export type { EmojiItem };

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

    const target = editor.view.dom;
    target.addEventListener('keydown', handleKeyDown, true);
    return () => target.removeEventListener('keydown', handleKeyDown, true);
  }, [suggestionState?.active, items, selectedIndex, insertEmoji, editor]);

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
            background: i === selectedIndex ? 'rgb(var(--color-border-100, 237 242 247))' : 'transparent',
          }}
        >
          {item.native}
        </div>
      ))}
    </div>,
    document.body
  );
}
