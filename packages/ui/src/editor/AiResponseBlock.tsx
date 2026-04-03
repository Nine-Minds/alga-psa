'use client';

import React from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { Sparkles } from 'lucide-react';

/**
 * TipTap Node extension that wraps AI-generated content in a visually distinct
 * container while it streams in. The wrapper is automatically removed by the
 * Hocuspocus AiParticipantExtension once streaming completes, replacing it
 * with properly formatted content.
 */

function AiResponseBlockView() {
  return (
    <NodeViewWrapper as="div" className="ai-response-block">
      <div className="ai-response-block__header">
        <div className="ai-response-block__label">
          <Sparkles className="ai-response-block__icon" />
          <span>Alga AI</span>
          <span className="ai-response-block__streaming-dot" />
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
