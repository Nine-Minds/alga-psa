import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const conversationPath = path.resolve(__dirname, './TicketConversation.tsx');

function getTicketConversationSource(): string {
  return fs.readFileSync(conversationPath, 'utf-8');
}

describe('TicketConversation clipboard upload wiring', () => {
  it('T003: starts upload flow from editor upload callback independent of submit action', () => {
    const source = getTicketConversationSource();

    expect(source).toContain('const handleSubmitComment = async () =>');
    expect(source).toContain('const handleClipboardImageUpload = React.useCallback(');
    expect(source).toContain('uploadFile={enableClipboardImageSupport ? handleClipboardImageUpload : undefined}');

    const submitHandlerMatch = source.match(
      /const handleSubmitComment = async \(\) => \{([\s\S]*?)\n\s*\};/
    );
    expect(submitHandlerMatch?.[1]).toBeTruthy();
    expect(submitHandlerMatch?.[1]).not.toContain('uploadDocument(');
  });

  it('T004: uploads pasted image through ticket document pipeline with ticket scoping', () => {
    const source = getTicketConversationSource();

    expect(source).toContain('const formData = new FormData()');
    expect(source).toContain("formData.append('file', renamedFile)");
    expect(source).toContain('const uploadResult = await uploadDocument(formData, {');
    expect(source).toContain('ticketId: ticket.ticket_id');
  });
});
