import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const conversationPath = path.resolve(__dirname, './TicketConversation.tsx');

function getTicketConversationSource(): string {
  return fs.readFileSync(conversationPath, 'utf-8');
}

describe('TicketConversation clipboard upload wiring', () => {
  it('routes compose and existing-comment uploads through the shared ticket rich-text session helper', () => {
    const source = getTicketConversationSource();

    expect(source).toContain('const handleSubmitComment = async () =>');
    expect(source).toContain("import { useTicketRichTextUploadSession } from './useTicketRichTextUploadSession';");
    expect(source).toContain('const composeUploadSession = useTicketRichTextUploadSession({');
    expect(source).toContain('trackDraftUploads: true');
    expect(source).toContain('const existingCommentUploadSession = useTicketRichTextUploadSession({');
    expect(source).toContain('trackDraftUploads: false');
    expect(source).toContain('uploadFile={composeUploadSession.uploadFile}');
    expect(source).toContain('uploadFile={existingCommentUploadSession.uploadFile}');

    const submitHandlerMatch = source.match(
      /const handleSubmitComment = async \(\) => \{([\s\S]*?)\n\s*\};/
    );
    expect(submitHandlerMatch?.[1]).toBeTruthy();
    expect(submitHandlerMatch?.[1]).not.toContain('uploadDocument(');
  });

  it('keeps the compose cancel dialog wired to the shared tracked session', () => {
    const source = getTicketConversationSource();

    expect(source).toContain('const handleCancelComment = () => {');
    expect(source).toContain('composeUploadSession.requestDiscard()');
    expect(source).toContain('isOpen={composeUploadSession.showDraftCancelDialog}');
    expect(source).toContain('onConfirm={composeUploadSession.deleteTrackedDraftClipboardImages}');
    expect(source).toContain('onCancel={composeUploadSession.keepDraftClipboardImages}');
  });

  it('resets tracked drafts after a successful submit without inlining upload logic in the component', () => {
    const source = getTicketConversationSource();

    expect(source).toContain('composeUploadSession.resetDraftTracking()');
    expect(source).toContain('setShowEditor(false)');
    expect(source).not.toContain('const uploadResult = await uploadDocument(formData, {');
  });
});
