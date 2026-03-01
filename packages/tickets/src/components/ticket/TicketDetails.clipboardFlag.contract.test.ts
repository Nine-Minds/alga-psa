import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TicketDetails clipboard image feature flag contract', () => {
  it('T027: does not gate clipboard image paste support behind a feature flag', () => {
    const ticketDetailsPath = path.resolve(__dirname, './TicketDetails.tsx');
    const source = fs.readFileSync(ticketDetailsPath, 'utf-8');

    expect(source).not.toContain("useFeatureFlag('ticket-comment-clipboard-images'");
    expect(source).not.toContain('enableClipboardImageSupport=');
  });

  it('T028: wires clipboard image upload flow directly in ticket conversation', () => {
    const conversationPath = path.resolve(__dirname, './TicketConversation.tsx');
    const source = fs.readFileSync(conversationPath, 'utf-8');

    expect(source).toContain('uploadFile={handleClipboardImageUpload}');
    expect(source).not.toContain('enableClipboardImageSupport');
  });
});
