import { describe, it, expect } from 'vitest';

/**
 * Unit Tests: extractMentionUserIds
 *
 * Tests the extraction of user IDs from BlockNote mention inline content,
 * which is the format used by both web and mobile editors.
 * Also covers ProseMirror format and nested block structures.
 */

// Inline copy of the function from internalNotificationSubscriber.ts
// to test in isolation without importing the full subscriber.
function extractMentionUserIds(content: any): string[] {
  if (!content) return [];

  const userIds: string[] = [];

  try {
    // Parse content if it's a string
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;

    // Handle ProseMirror doc wrapper: { type: 'doc', content: [...] }
    const blocks = parsed?.type === 'doc' && Array.isArray(parsed.content)
      ? parsed.content
      : Array.isArray(parsed) ? parsed : [];

    // Recursively traverse blocks to find mention inline content
    function traverseBlocks(blockList: any[]): void {
      for (const block of blockList) {
        if (!block || typeof block !== 'object') continue;

        // Check inline content array (BlockNote format)
        if (block.content && Array.isArray(block.content)) {
          for (const inlineContent of block.content) {
            if (inlineContent?.type === 'mention') {
              // BlockNote format: props.userId
              const userId = inlineContent.props?.userId
                // ProseMirror format: attrs.userId or attrs.id
                || inlineContent.attrs?.userId
                || inlineContent.attrs?.id;
              if (userId) {
                userIds.push(userId);
              }
            }
          }
        }

        // Check ProseMirror node-level mentions (mention as a node, not inline content)
        if (block.type === 'mention') {
          const userId = block.props?.userId || block.attrs?.userId || block.attrs?.id;
          if (userId) {
            userIds.push(userId);
          }
        }

        // Recurse into children (BlockNote nested blocks)
        if (block.children && Array.isArray(block.children)) {
          traverseBlocks(block.children);
        }
      }
    }

    traverseBlocks(blocks);
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

  // --- New tests for nested blocks and ProseMirror format ---

  it('should extract mentions from nested children blocks', () => {
    const content = [
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'Item 1' }],
        children: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', props: { userId: 'user-nested', username: 'nested', displayName: 'Nested User' } },
            ],
          },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['user-nested']);
  });

  it('should extract mentions from deeply nested children', () => {
    const content = [
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'Level 1' }],
        children: [
          {
            type: 'bulletListItem',
            content: [{ type: 'text', text: 'Level 2' }],
            children: [
              {
                type: 'paragraph',
                content: [
                  { type: 'mention', props: { userId: 'deep-user', username: 'deep', displayName: 'Deep User' } },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['deep-user']);
  });

  it('should extract mentions from both top-level and nested blocks', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', props: { userId: 'top-user', username: 'top', displayName: 'Top User' } },
        ],
      },
      {
        type: 'bulletListItem',
        content: [{ type: 'text', text: 'List item' }],
        children: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', props: { userId: 'nested-user', username: 'nested', displayName: 'Nested User' } },
            ],
          },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['top-user', 'nested-user']);
  });

  it('should handle ProseMirror doc wrapper format', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { userId: 'pm-user', username: 'pm', displayName: 'PM User' } },
          ],
        },
      ],
    };

    expect(extractMentionUserIds(content)).toEqual(['pm-user']);
  });

  it('should handle ProseMirror attrs.id format', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: 'pm-id-user' } },
          ],
        },
      ],
    };

    expect(extractMentionUserIds(content)).toEqual(['pm-id-user']);
  });

  it('should handle ProseMirror node-level mention (not inside content array)', () => {
    const content = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
        ],
        children: [
          { type: 'mention', props: { userId: 'node-mention' } },
        ],
      },
    ];

    expect(extractMentionUserIds(content)).toEqual(['node-mention']);
  });
});
