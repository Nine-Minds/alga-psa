import { expect, it } from 'vitest';
import { conversationText, conversationDocument } from '../../../components/co-managed/conversationText';
const plain = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);
it('preserves literal HTML, JSON and URLs as text without resolving embedded resources', () => {
  const text = '<script>literal</script> {"id":"foreign"} https://example.test';
  expect(conversationText(plain(text), null)).toBe(text);
  expect(conversationDocument(plain(text))?.[0].content[0].text).toBe(text);
  expect(conversationText(JSON.stringify([{ type: 'image', props: { url: 'https://example.test/secret' } }, { type: 'paragraph', content: [{ type: 'mention', props: { userId: 'foreign' } }] }]), null)).not.toContain('https:');
});
it.each([
  [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold', styles: { bold: true } }] }],
  [{ type: 'heading', content: [{ type: 'text', text: 'Heading' }] }],
  [{ type: 'paragraph', content: [{ type: 'link', href: 'https://example.test/', content: [{ type: 'text', text: 'Link' }] }] }],
])('preserves supported rich blocks for editing (%j)', blocks => {
  expect(conversationDocument(JSON.stringify([blocks]))?.[0]).toMatchObject(blocks);
});
it('preserves line breaks for newly authored paragraphs', () => {
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'First', styles: {} }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second', styles: {} }] }];
  expect(conversationDocument(JSON.stringify(blocks))?.map(block => block.content[0].text)).toEqual(['First', 'Second']);
  expect(conversationText(JSON.stringify(blocks), null)).toBe('First\nSecond');
});

it('refuses destructive edits of attached or malformed messages', () => {
  expect(conversationDocument(JSON.stringify([{ type: 'image', props: { url: '/api/attachments/foreign' } }]))).toBeNull();
  expect(conversationDocument(JSON.stringify({ hidden: 'object' }))).toBeNull();
});
