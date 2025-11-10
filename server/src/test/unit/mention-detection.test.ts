/**
 * Unit tests for @mention detection functionality
 */

describe('Mention Detection', () => {
  /**
   * Parse comment text for @mentions
   * Supports both @username and @[Display Name] formats
   */
  function extractMentions(text: string): string[] {
    if (!text) return [];

    const mentions: string[] = [];

    // Pattern 1: @username (alphanumeric and underscores, must start with letter)
    const usernamePattern = /@([a-zA-Z][a-zA-Z0-9_]*)/g;
    let match;
    while ((match = usernamePattern.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    // Pattern 2: @[Display Name] (any characters between brackets)
    const displayNamePattern = /@\[([^\]]+)\]/g;
    while ((match = displayNamePattern.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    // Remove duplicates and return
    return Array.from(new Set(mentions));
  }

  describe('extractMentions', () => {
    it('should extract username mentions', () => {
      const text = 'Hey @john, can you help @jane with this?';
      const mentions = extractMentions(text);
      expect(mentions).toEqual(['john', 'jane']);
    });

    it('should extract display name mentions', () => {
      const text = 'Hey @[John Doe], can you help @[Jane Smith] with this?';
      const mentions = extractMentions(text);
      expect(mentions).toEqual(['John Doe', 'Jane Smith']);
    });

    it('should extract mixed format mentions', () => {
      const text = 'Hey @john and @[Jane Smith], can you both help?';
      const mentions = extractMentions(text);
      expect(mentions).toEqual(['john', 'Jane Smith']);
    });

    it('should handle duplicate mentions', () => {
      const text = 'Hey @john, @john are you there?';
      const mentions = extractMentions(text);
      expect(mentions).toEqual(['john']);
    });

    it('should handle empty text', () => {
      const mentions = extractMentions('');
      expect(mentions).toEqual([]);
    });

    it('should handle text with no mentions', () => {
      const text = 'This is a comment with no mentions';
      const mentions = extractMentions(text);
      expect(mentions).toEqual([]);
    });

    it('should handle username with numbers and underscores', () => {
      const text = 'Hey @john_doe123, can you help?';
      const mentions = extractMentions(text);
      expect(mentions).toEqual(['john_doe123']);
    });

    it('should not match usernames starting with numbers', () => {
      const text = 'Hey @123john, can you help?';
      const mentions = extractMentions(text);
      expect(mentions).toEqual([]);
    });

    it('should handle display names with special characters', () => {
      const text = 'Hey @[Jean-Pierre O\'Connor], can you help?';
      const mentions = extractMentions(text);
      expect(mentions).toEqual(["Jean-Pierre O'Connor"]);
    });

    it('should handle mentions at start and end of text', () => {
      const text = '@john mentioned this to @jane';
      const mentions = extractMentions(text);
      expect(mentions).toEqual(['john', 'jane']);
    });

    it('should handle multiple mentions of same user in different formats', () => {
      const text = 'Hey @john and @[John Doe], same person?';
      const mentions = extractMentions(text);
      // Note: These are treated as different mentions since one is username and one is display name
      // The database lookup will resolve them to the same user if they match
      expect(mentions).toEqual(['john', 'John Doe']);
    });

    it('should handle markdown formatted text', () => {
      const text = '**Important:** @john please review this\n\n- Item 1\n- @jane handle this';
      const mentions = extractMentions(text);
      expect(mentions).toEqual(['john', 'jane']);
    });
  });
});
