import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TicketDetails clipboard image feature flag contract', () => {
  it('T027: defaults clipboard image paste support off behind feature flag gate', () => {
    const ticketDetailsPath = path.resolve(__dirname, './TicketDetails.tsx');
    const source = fs.readFileSync(ticketDetailsPath, 'utf-8');

    expect(source).toContain("useFeatureFlag('ticket-comment-clipboard-images'");
    expect(source).toContain('defaultValue: false');
    expect(source).toContain('enableClipboardImageSupport={clipboardImageCommentsEnabled}');
  });

  it('T028: enables clipboard image upload flow when flag resolves true', () => {
    const conversationPath = path.resolve(__dirname, './TicketConversation.tsx');
    const source = fs.readFileSync(conversationPath, 'utf-8');

    expect(source).toContain('enableClipboardImageSupport = false');
    expect(source).toContain('uploadFile={enableClipboardImageSupport ? handleClipboardImageUpload : undefined}');
  });
});
