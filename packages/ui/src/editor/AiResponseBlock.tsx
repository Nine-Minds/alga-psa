'use client';

import React, { useCallback } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { Check, X, Sparkles } from 'lucide-react';

/**
 * TipTap Node extension that wraps AI-generated content in a visually distinct
 * container with Accept / Dismiss controls.
 *
 * - Accept: unwraps children into the parent document as regular content
 * - Dismiss: removes the entire AI response block
 */

// ── React NodeView ───────────────────────────────────────────────

function AiResponseBlockView(props: any) {
  const { editor, getPos, node } = props;

  const handleAccept = useCallback(() => {
    if (!editor || typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;

    const resolvedPos = editor.state.doc.resolve(pos);
    const nodeAtPos = editor.state.doc.nodeAt(pos);
    if (!nodeAtPos) return;

    // Replace the wrapper with its children
    const content = nodeAtPos.content;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.replaceWith(pos, pos + nodeAtPos.nodeSize, content);
        return true;
      })
      .run();
  }, [editor, getPos]);

  const handleDismiss = useCallback(() => {
    if (!editor || typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos == null) return;

    const nodeAtPos = editor.state.doc.nodeAt(pos);
    if (!nodeAtPos) return;

    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.delete(pos, pos + nodeAtPos.nodeSize);
        return true;
      })
      .run();
  }, [editor, getPos]);

  return (
    <NodeViewWrapper as="div" className="ai-response-block">
      <div className="ai-response-block__header">
        <div className="ai-response-block__label">
          <Sparkles className="ai-response-block__icon" />
          <span>Alga AI</span>
        </div>
        <div className="ai-response-block__actions">
          <button
            type="button"
            className="ai-response-block__btn ai-response-block__btn--accept"
            onClick={handleAccept}
            title="Accept — keep this content"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Accept</span>
          </button>
          <button
            type="button"
            className="ai-response-block__btn ai-response-block__btn--dismiss"
            onClick={handleDismiss}
            title="Dismiss — remove this content"
          >
            <X className="w-3.5 h-3.5" />
            <span>Dismiss</span>
          </button>
        </div>
      </div>
      <div className="ai-response-block__content">
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  );
}

// ── TipTap Node Extension ────────────────────────────────────────

export const AiResponseBlock = Node.create({
  name: 'aiResponseBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-ai-response]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-ai-response': '' }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AiResponseBlockView);
  },
});
