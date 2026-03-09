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

  it('T037: saved comment delete flow offers comment-only and comment-plus-images paths', () => {
    const ticketDetailsPath = path.resolve(__dirname, './TicketDetails.tsx');
    const commentItemPath = path.resolve(__dirname, './CommentItem.tsx');
    const ticketDetailsSource = fs.readFileSync(ticketDetailsPath, 'utf-8');
    const commentItemSource = fs.readFileSync(commentItemPath, 'utf-8');

    expect(ticketDetailsSource).toContain('resolveCommentReferencedImageDocuments(conversation.note, documents)');
    expect(ticketDetailsSource).toContain("onConfirm={() => handleDeleteConfirm(true)}");
    expect(ticketDetailsSource).toContain("onCancel={deleteDialogHasImages ? () => handleDeleteConfirm(false) : undefined}");
    expect(ticketDetailsSource).toContain("thirdButtonLabel={deleteDialogHasImages ? 'Delete Comment Only' : undefined}");
    expect(ticketDetailsSource).toContain("confirmLabel={deleteDialogHasImages ? 'Delete Comment + Images' : 'Delete'}");
    expect(ticketDetailsSource).toContain('const result = await deleteDraftClipboardImages({');
    expect(commentItemSource).toContain('onClick={() => onDelete(conversation)}');
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
