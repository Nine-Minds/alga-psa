import { describe, expect, it } from 'vitest';

import chatSource from '../../../../ee/server/src/components/chat/Chat.tsx?raw';

describe('EE Chat (source)', () => {
  it('uses the streaming completions endpoint for new messages', () => {
    expect(chatSource).toContain("fetch('/api/chat/v1/completions/stream',");
    expect(chatSource).toContain('messages: conversationWithUser');
    expect(chatSource).toContain('uiContext: aiContext');

    expect(chatSource).not.toContain("fetch('/api/chat/v1/completions'");
  });

  it('includes uiContext on execute requests as well', () => {
    expect(chatSource).toContain("fetch('/api/chat/v1/execute',");
    expect(chatSource).toContain('chatId: pendingFunction.chatId ?? chatId');
    expect(chatSource).toContain('uiContext: aiContext');
  });

  it('reads the streaming response through the SSE helper', () => {
    expect(chatSource).toContain('readAssistantContentFromSse(response');
    expect(chatSource).toContain('onToolCalls: (proposal: SseFunctionProposal)');
  });
});
