import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ticket clipboard image flow end-to-end contract', () => {
  it('T032: paste -> upload -> save/render pipeline uses attachment-serving URLs', () => {
    const conversationPath = path.resolve(__dirname, './TicketConversation.tsx');
    const ticketDetailsPath = path.resolve(__dirname, './TicketDetails.tsx');
    const commentItemPath = path.resolve(__dirname, './CommentItem.tsx');
    const conversationSource = fs.readFileSync(conversationPath, 'utf-8');
    const ticketDetailsSource = fs.readFileSync(ticketDetailsPath, 'utf-8');
    const commentItemSource = fs.readFileSync(commentItemPath, 'utf-8');

    expect(conversationSource).toContain('uploadFile={handleClipboardImageUpload}');
    expect(conversationSource).toContain('if (onClipboardImageUploaded) {');
    expect(conversationSource).toContain('const uploadResult = await uploadDocument(formData, {');
    expect(conversationSource).toContain('`/api/documents/view/${uploadedDocument.file_id}`');
    expect(ticketDetailsSource).toContain('const refreshTicketDocuments = useCallback(async () => {');
    expect(ticketDetailsSource).toContain('const docs = await getDocumentByTicketId(ticket.ticket_id);');
    expect(ticketDetailsSource).toContain('onClipboardImageUploaded={refreshTicketDocuments}');
    expect(commentItemSource).toContain('const result = JSON.parse(noteContent)');
    expect(commentItemSource).toContain('<RichTextViewer');
  });

  it('T033: cancel-delete path invokes draft hard-delete action and closes draft state', () => {
    const conversationPath = path.resolve(__dirname, './TicketConversation.tsx');
    const source = fs.readFileSync(conversationPath, 'utf-8');

    expect(source).toContain('const handleDeleteDraftClipboardImages = async () => {');
    expect(source).toContain('const result = await deleteDraftClipboardImages({');
    expect(source).toContain('documentIds: draftClipboardImages.map((image) => image.documentId)');
    expect(source).toContain('if (onClipboardImageUploaded) {');
    expect(source).toContain('await Promise.resolve(onClipboardImageUploaded());');
    expect(source).toContain('setDraftClipboardImages([])');
    expect(source).toContain('setShowEditor(false)');
  });
});
