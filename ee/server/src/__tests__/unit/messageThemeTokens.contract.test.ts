import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const messageStyles = readFileSync(
  fileURLToPath(new URL('../../components/message/message.css', import.meta.url)),
  'utf8',
);

describe('AI message Markdown theme colors', () => {
  it('pins semantic Markdown text to tenant theme tokens', () => {
    expect(messageStyles).toContain('.message-content h1');
    expect(messageStyles).toContain('.message-reasoning__content h1');
    expect(messageStyles).toContain('color: rgb(var(--color-text-900));');
    expect(messageStyles).toContain('.message-content li::marker');
    expect(messageStyles).toContain('.message-content blockquote');
    expect(messageStyles).toContain('.message-content hr');
    expect(messageStyles).toContain('.message-content pre code');
  });

  it('does not use a fixed light- or dark-theme foreground for Markdown content', () => {
    const markdownRules = messageStyles.slice(
      messageStyles.indexOf('.message-content {'),
      messageStyles.indexOf('.message-reasoning {'),
    );

    expect(markdownRules).not.toMatch(/color:\s*(?:black|white|#(?:000(?:000)?|fff(?:fff)?))\b/i);
  });
});
