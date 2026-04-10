import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readTicketInfoSource(): string {
  const filePath = path.resolve(__dirname, './TicketInfo.tsx');
  return fs.readFileSync(filePath, 'utf-8');
}

describe('TicketInfo rich-text description contract', () => {
  it('uses the shared parser and serializer for description state', () => {
    const source = readTicketInfoSource();

    expect(source).toContain("import { parseTicketRichTextContent, serializeTicketRichTextContent } from '../../lib/ticketRichText';");
    expect(source).toContain('parseTicketRichTextContent(ticket.attributes?.description as string | undefined)');
    expect(source).toContain('serializeTicketRichTextContent(descriptionContent)');
    expect(source).toContain('return onUpdateDescription(serializeTicketRichTextContent(descriptionContent));');
  });

  it('wires the shared editor affordances into description edit mode', () => {
    const source = readTicketInfoSource();

    expect(source).toContain('searchMentions={searchUsersForMentions}');
    expect(source).toContain('uploadFile={descriptionUploadSession.uploadFile}');
    expect(source).toContain('<RichTextViewer content={descriptionText}');
  });

  it('shows a keep/delete dialog when canceling description edits with uploaded draft images', () => {
    const source = readTicketInfoSource();

    expect(source).toContain('isOpen={descriptionUploadSession.showDraftCancelDialog}');
    expect(source).toContain('onConfirm={descriptionUploadSession.deleteTrackedDraftClipboardImages}');
    expect(source).toContain('onCancel={descriptionUploadSession.keepDraftClipboardImages}');
    expect(source).toContain("thirdButtonLabel={t('conversation.keepUploadedImages', 'Keep Images')}");
    expect(source).toContain("message={t('info.clipboardDraftMessage', 'This description includes pasted images that were already uploaded as ticket documents. Keep them, or delete them permanently?')}");
  });
});
