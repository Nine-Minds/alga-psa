import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ticket clipboard image flow end-to-end contract', () => {
  it('routes description and comment editors through the shared ticket rich-text helpers', () => {
    const conversationPath = path.resolve(__dirname, './TicketConversation.tsx');
    const ticketInfoPath = path.resolve(__dirname, './TicketInfo.tsx');
    const ticketDetailsPath = path.resolve(__dirname, './TicketDetails.tsx');
    const commentItemPath = path.resolve(__dirname, './CommentItem.tsx');
    const conversationSource = fs.readFileSync(conversationPath, 'utf-8');
    const ticketInfoSource = fs.readFileSync(ticketInfoPath, 'utf-8');
    const ticketDetailsSource = fs.readFileSync(ticketDetailsPath, 'utf-8');
    const commentItemSource = fs.readFileSync(commentItemPath, 'utf-8');

    expect(conversationSource).toContain('useTicketRichTextUploadSession');
    expect(conversationSource).toContain('uploadFile={composeUploadSession.uploadFile}');
    expect(ticketInfoSource).toContain('useTicketRichTextUploadSession');
    expect(ticketInfoSource).toContain('uploadFile={descriptionUploadSession.uploadFile}');
    expect(ticketInfoSource).toContain('searchMentions={searchUsersForMentions}');
    expect(ticketDetailsSource).toContain('const refreshTicketDocuments = useCallback(async () => {');
    expect(ticketDetailsSource).toContain('const docs = await getDocumentByTicketId(ticket.ticket_id);');
    expect(ticketDetailsSource).toContain('onClipboardImageUploaded={refreshTicketDocuments}');
    expect(ticketDetailsSource).toContain('onClipboardImageUploaded={refreshTicketDocuments}');
    expect(commentItemSource).toContain("import { parseTicketRichTextContent } from '../../lib/ticketRichText';");
    expect(commentItemSource).toContain('parseCommentNoteContent');
    expect(commentItemSource).toContain('<RichTextViewer');
  });

  it('T034: edit-mode content changes do not mutate TicketDetails currentComment state on every keystroke', () => {
    const ticketDetailsPath = path.resolve(__dirname, './TicketDetails.tsx');
    const source = fs.readFileSync(ticketDetailsPath, 'utf-8');

    expect(source).toContain('const handleContentChange = useCallback((_blocks: PartialBlock[]) => {');
    expect(source).not.toContain('setCurrentComment({ ...currentComment, note: JSON.stringify(blocks) });');
  });

  it('T035: TextEditor does not hide all draggable nodes (clipboard image blocks remain visible)', () => {
    const textEditorPath = path.resolve(__dirname, '../../../../ui/src/editor/TextEditor.tsx');
    const source = fs.readFileSync(textEditorPath, 'utf-8');

    expect(source).not.toContain("[&_[draggable='true']]:!hidden");
    expect(source).not.toContain('[&_.bn-block-outer_[data-drag-handle]]:!hidden');
  });

  it('T036: edit-mode TextEditor preserves image/media-only blocks when trimming empty trailing content', () => {
    const textEditorPath = path.resolve(__dirname, '../../../../ui/src/editor/TextEditor.tsx');
    const source = fs.readFileSync(textEditorPath, 'utf-8');

    expect(source).toContain("const mediaBlockTypes = new Set(['image', 'video', 'audio', 'file']);");
    expect(source).toContain('if (typeof block.type === \'string\' && mediaBlockTypes.has(block.type)) {');
    expect(source).toContain('return Boolean(props?.url || props?.name);');
  });
});
