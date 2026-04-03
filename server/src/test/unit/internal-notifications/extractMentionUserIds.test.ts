import { describe, it, expect } from 'vitest';

/**
 * Unit Tests: extractMentionUserIds
 *
 * Tests the extraction of user IDs from BlockNote mention inline content,
 * which is the format used by both web and mobile editors.
 */

// Inline copy of the function from internalNotificationSubscriber.ts
// to test in isolation without importing the full subscriber.
function extractMentionUserIds(content: any): string[] {
  if (!content) return [];

  const userIds: string[] = [];

  try {
    const blocks = typeof content === 'string' ? JSON.parse(content) : content;

    if (!Array.isArray(blocks)) return [];

    for (const block of blocks) {
      if (block.content && Array.isArray(block.content)) {
        for (const inlineContent of block.content) {
          if (inlineContent.type === 'mention' && inlineContent.props?.userId) {
            userIds.push(inlineContent.props.userId);
          }
        }
      }
    }
  } catch (error) {
    // Parsing error — return empty
  }

  return Array.from(new Set(userIds));
}

describe('extractMentionUserIds', () => {
  it('should extract userId from BlockNote mention inline content', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hey ' },
          { type: 'mention', props: { userId: 'user-1', username: 'john', displayName: 'John Doe' } },
          { type: 'text', text: ' can you help?' },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['user-1']);
  });

  it('should extract multiple mentions from a single block', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', props: { userId: 'user-1', username: 'john', displayName: 'John' } },
          { type: 'text', text: ' and ' },
          { type: 'mention', props: { userId: 'user-2', username: 'sarah', displayName: 'Sarah' } },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['user-1', 'user-2']);
  });

  it('should extract mentions from multiple blocks', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', props: { userId: 'user-1', username: 'john', displayName: 'John' } },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'mention', props: { userId: 'user-2', username: 'sarah', displayName: 'Sarah' } },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['user-1', 'user-2']);
  });

  it('should deduplicate repeated mentions', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', props: { userId: 'user-1', username: 'john', displayName: 'John' } },
          { type: 'text', text: ' and ' },
          { type: 'mention', props: { userId: 'user-1', username: 'john', displayName: 'John' } },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['user-1']);
  });

  it('should parse JSON string content (as stored in DB)', () => {
    const content = JSON.stringify([
      {
        type: 'paragraph',
        content: [
          { type: 'mention', props: { userId: 'user-1', username: 'john', displayName: 'John' } },
        ],
      },
    ]);

    expect(extractMentionUserIds(content)).toEqual(['user-1']);
  });

  it('should handle mobile editor output format (ProseMirror converted to BlockNote)', () => {
    // This is the format produced by convertProseMirrorToTicketRichTextBlocks
    // when the mobile TipTap editor inserts a mention node
    const content = [
      {
        type: 'paragraph',
        props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
        content: [
          { type: 'text', text: 'Hello ', styles: {} },
          { type: 'mention', props: { userId: 'abc-123', username: 'jane', displayName: 'Jane Smith' } },
          { type: 'text', text: ' ', styles: {} },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['abc-123']);
  });

  it('should return empty array for null/undefined content', () => {
    expect(extractMentionUserIds(null)).toEqual([]);
    expect(extractMentionUserIds(undefined)).toEqual([]);
  });

  it('should return empty array for non-array content', () => {
    expect(extractMentionUserIds('plain text')).toEqual([]);
    expect(extractMentionUserIds(42)).toEqual([]);
    expect(extractMentionUserIds({})).toEqual([]);
  });

  it('should return empty array for blocks without mentions', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Just a regular comment' },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual([]);
  });

  it('should skip mention nodes without userId', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', props: { username: 'john', displayName: 'John' } },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual([]);
  });

  it('should handle blocks without content array', () => {
    const content = [
      { type: 'paragraph' },
      { type: 'image', props: { url: 'https://example.com/img.png' } },
    ];

    expect(extractMentionUserIds(content)).toEqual([]);
  });

  it('should handle malformed JSON string gracefully', () => {
    expect(extractMentionUserIds('{invalid json')).toEqual([]);
  });
});
