import { expect, it } from 'vitest';
import { conversationText, plainConversationDraft } from '../../../components/co-managed/conversationText';
const plain = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);
it('preserves literal HTML, JSON and URLs as text without resolving embedded resources', () => {
  const text = '<script>literal</script> {"id":"foreign"} https://example.test';
  expect(conversationText(plain(text), null)).toBe(text);
  expect(plainConversationDraft(plain(text))).toBe(text);
  expect(conversationText(JSON.stringify([{ type: 'image', props: { url: 'https://example.test/secret' } }, { type: 'paragraph', content: [{ type: 'mention', props: { userId: 'foreign' } }] }]), null)).not.toContain('https:');
});
it.each([
  [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold', styles: { bold: true } }] }],
  [{ type: 'heading', content: [{ type: 'text', text: 'Heading' }] }],
  [{ type: 'paragraph', content: [{ type: 'link', href: 'https://example.test', content: [{ type: 'text', text: 'Link' }] }] }],
  [{ type: 'image', props: { url: '/api/attachments/foreign' } }],
])('does not offer destructive plain-text editing for formatted or attached content (%j)', blocks => {
  expect(plainConversationDraft(JSON.stringify([blocks]))).toBeNull();
});
it('preserves line breaks for newly authored paragraphs', () => {
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'First', styles: {} }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second', styles: {} }] }];
  expect(plainConversationDraft(JSON.stringify(blocks))).toBe('First\nSecond');
  expect(conversationText(JSON.stringify(blocks), null)).toBe('First\nSecond');
});
