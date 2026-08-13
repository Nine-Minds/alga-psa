import { describe, expect, it } from 'vitest';

import { filterHiddenNoiseComments, isHiddenNoiseComment } from './commentNoise';

const comment = (note: string | null, overrides: Record<string, unknown> = {}): any => ({
  comment_id: 'comment-1',
  note,
  ...overrides,
});

const imageBlock = (url: string) => ({
  id: 'block-1',
  type: 'image',
  props: {
    textAlignment: 'left',
    backgroundColor: 'default',
    name: 'image.png',
    url,
    caption: '',
    showPreview: true,
  },
  children: [],
});

const paragraphBlock = (text: string) => ({
  id: 'block-0',
  type: 'paragraph',
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});

describe('isHiddenNoiseComment', () => {
  it('keeps an image-only comment visible', () => {
    const note = JSON.stringify([imageBlock('/api/documents/view/file-123')]);
    expect(isHiddenNoiseComment(comment(note))).toBe(false);
  });

  it('keeps a media-only comment visible for every media block type', () => {
    for (const type of ['image', 'video', 'audio', 'file']) {
      const note = JSON.stringify([{ type, props: { url: '/api/documents/view/file-1' }, children: [] }]);
      expect(isHiddenNoiseComment(comment(note))).toBe(false);
    }
  });

  it('keeps an image nested in a block child visible', () => {
    const note = JSON.stringify([
      { id: 'b', type: 'paragraph', props: {}, content: [], children: [imageBlock('/api/documents/view/file-9')] },
    ]);
    expect(isHiddenNoiseComment(comment(note))).toBe(false);
  });

  it('keeps a comment mixing text and an image visible', () => {
    const note = JSON.stringify([paragraphBlock('hello?'), imageBlock('/api/documents/view/file-2')]);
    expect(isHiddenNoiseComment(comment(note))).toBe(false);
  });

  it('hides a truly empty comment', () => {
    expect(isHiddenNoiseComment(comment(JSON.stringify([paragraphBlock('   ')])))).toBe(true);
    expect(isHiddenNoiseComment(comment(''))).toBe(true);
    expect(isHiddenNoiseComment(comment(null))).toBe(true);
  });

  it('hides an empty media block that carries neither url nor name', () => {
    const note = JSON.stringify([{ type: 'image', props: { caption: '' }, children: [] }]);
    expect(isHiddenNoiseComment(comment(note))).toBe(true);
  });

  it('still hides reply-token-only comments', () => {
    const note = JSON.stringify([paragraphBlock('[ALGA-REPLY-TOKEN abc-123 ticketId=TICKET-1]')]);
    expect(isHiddenNoiseComment(comment(note))).toBe(true);
    expect(isHiddenNoiseComment(comment('[ALGA-REPLY-TOKEN abc-123 ticketId=TICKET-1]'))).toBe(true);
  });

  it('still hides a reply-token-only comment that carried an image', () => {
    const note = JSON.stringify([
      paragraphBlock('[ALGA-REPLY-TOKEN abc-123 ticketId=TICKET-1]'),
      imageBlock('https://tracker.test/pixel.gif'),
    ]);
    expect(isHiddenNoiseComment(comment(note))).toBe(true);
  });

  it('keeps plain-text (non-JSON) comments visible', () => {
    expect(isHiddenNoiseComment(comment('a plain note'))).toBe(false);
  });
});

describe('filterHiddenNoiseComments', () => {
  it('retains image-only comments in the rendered list', () => {
    const imageOnly = comment(JSON.stringify([imageBlock('/api/documents/view/file-1')]), {
      comment_id: 'image-only',
    });
    const empty = comment(JSON.stringify([paragraphBlock('')]), { comment_id: 'empty' });

    const result = filterHiddenNoiseComments([imageOnly, empty]);

    expect(result.map((c) => c.comment_id)).toEqual(['image-only']);
  });

  it('keeps a hidden noise comment that still has descendants', () => {
    const parent = comment(JSON.stringify([paragraphBlock('')]), { comment_id: 'parent' });
    const child = comment(JSON.stringify([paragraphBlock('reply')]), {
      comment_id: 'child',
      parent_comment_id: 'parent',
    });

    const result = filterHiddenNoiseComments([parent, child]);

    expect(result.map((c) => c.comment_id)).toEqual(['parent', 'child']);
  });
});
