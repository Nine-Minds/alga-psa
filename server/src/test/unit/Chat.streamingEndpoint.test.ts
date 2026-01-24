import { describe, expect, it } from 'vitest';

import chatSource from '../../../../ee/server/src/components/chat/Chat.tsx?raw';

describe('EE Chat (source)', () => {
  it('uses the streaming completions endpoint for new messages', () => {
    expect(chatSource).toContain("fetch('/api/chat/v1/completions/stream',");
    expect(chatSource).toContain('messages: conversationWithUser');

    expect(chatSource).not.toContain("fetch('/api/chat/v1/completions'");
  });

  it('reads the streaming response via response.body.getReader()', () => {
    expect(chatSource).toContain('response.body.getReader()');
    expect(chatSource).toContain('await reader.read()');
  });
});
