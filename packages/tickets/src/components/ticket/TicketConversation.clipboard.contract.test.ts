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

  it('T006/T007: returns attachment-backed image payload on success and surfaces upload failures', () => {
    const source = getTicketConversationSource();

    expect(source).toContain('uploadFile={enableClipboardImageSupport ? handleClipboardImageUpload : undefined}');
    expect(source).toContain('const viewUrl = uploadedDocument.file_id');
    expect(source).toContain('return {');
    expect(source).toContain('url: viewUrl');
    expect(source).toContain("throw new Error(uploadResult.error || 'Clipboard image upload failed.')");
    expect(source).toContain("throw new Error(validation.error)");
  });

  it('T008/T009: preserves editor-managed retry/remove affordances by throwing upload errors', () => {
    const source = getTicketConversationSource();

    expect(source).toContain("throw new Error('Ticket ID is required for clipboard image upload.')");
    expect(source).toContain("throw new Error('User session is required for clipboard image upload.')");
    expect(source).toContain("throw new Error(validation.error)");
    expect(source).toContain("throw new Error(uploadResult.error || 'Clipboard image upload failed.')");
  });

  it('T010: persists attachment-backed image reference URLs rather than raw image data payloads', () => {
    const source = getTicketConversationSource();

    expect(source).toContain("const viewUrl = uploadedDocument.file_id");
    expect(source).toContain('`/api/documents/view/${uploadedDocument.file_id}`');
    expect(source).toContain('url: viewUrl');
    expect(source).not.toContain('data:image');
  });
});
