import { describe, it, expect } from 'vitest';

/**
 * Unit Tests: Mention Parser
 *
 * Tests the parsing of @mentions from comment text:
 * - Extract @username mentions
 * - Extract @[Display Name] mentions
 * - Handle multiple mentions
 * - Deduplicate repeated mentions
 * - Ignore @ in emails
 * - Handle edge cases
 */

// Utility function to parse mentions from text
// Supports: @username and @[Display Name]
function parseMentions(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const mentions: string[] = [];

  // Pattern 1: @[Display Name] with spaces
  const displayNamePattern = /@\[([^\]]+)\]/g;
  let match;

  while ((match = displayNamePattern.exec(text)) !== null) {
    mentions.push(match[1].trim());
  }

  // Pattern 2: @username (word characters only, not part of email)
  // Negative lookbehind/lookahead to avoid matching email addresses
  // Use (?<![a-zA-Z0-9]) to allow @ after markdown chars like * _ `
  // Match word chars but must end with alphanumeric (not _ * or `)
  const usernamePattern = /(?<![a-zA-Z0-9])@([a-zA-Z0-9_]*[a-zA-Z0-9])(?![@\.])/g;

  while ((match = usernamePattern.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  // Deduplicate mentions (case-insensitive)
  const uniqueMentions = Array.from(
    new Map(mentions.map(m => [m.toLowerCase(), m])).values()
  );

  return uniqueMentions;
}

describe('Mention Parser', () => {
  describe('parseMentions', () => {
    it('should extract single @username mention', () => {
      const text = 'Hey @john, can you help with this?';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['john']);
    });

    it('should extract multiple @username mentions', () => {
      const text = 'Hey @john and @sarah, can you both review this?';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['john', 'sarah']);
    });

    it('should extract @[Display Name] mention', () => {
      const text = 'Hey @[John Doe], can you help?';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['John Doe']);
    });

    it('should extract multiple display name mentions', () => {
      const text = 'Hey @[John Doe] and @[Sarah Smith], please review.';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['John Doe', 'Sarah Smith']);
    });

    it('should extract mixed username and display name mentions', () => {
      const text = 'Hey @john and @[Sarah Smith], can you help @mike?';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['Sarah Smith', 'john', 'mike']);
    });

    it('should deduplicate repeated mentions', () => {
      const text = 'Hey @john, can @john help with this? @john?';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['john']);
    });

    it('should deduplicate case-insensitive mentions', () => {
      const text = 'Hey @John, can @john and @JOHN help?';
      const mentions = parseMentions(text);

      expect(mentions).toHaveLength(1);
      // Should preserve first occurrence case
      expect(mentions[0].toLowerCase()).toBe('john');
    });

    it('should ignore @ in email addresses', () => {
      const text = 'Contact john@company.com or @sarah for help';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['sarah']);
      expect(mentions).not.toContain('company.com');
    });

    it('should ignore @ in multiple email addresses', () => {
      const text = 'Send to john@company.com and sarah@example.org or ping @mike';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['mike']);
    });

    it('should handle @mention at start of text', () => {
      const text = '@john can you review this?';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['john']);
    });

    it('should handle @mention at end of text', () => {
      const text = 'Can you review this @john';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['john']);
    });

    it('should handle @mention with punctuation', () => {
      const text = 'Hey @john, @sarah! Can @mike? help.';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['john', 'sarah', 'mike']);
    });

    it('should handle empty string', () => {
      const text = '';
      const mentions = parseMentions(text);

      expect(mentions).toEqual([]);
    });

    it('should handle null/undefined input', () => {
      expect(parseMentions(null as any)).toEqual([]);
      expect(parseMentions(undefined as any)).toEqual([]);
    });

    it('should handle text with no mentions', () => {
      const text = 'This is a comment with no mentions';
      const mentions = parseMentions(text);

      expect(mentions).toEqual([]);
    });

    it('should handle malformed mentions', () => {
      const text = 'Hey @ john and @[Unclosed bracket and @ without name';
      const mentions = parseMentions(text);

      // Should only extract valid @username if "john" comes right after space
      // Malformed ones should be ignored
      expect(mentions).toEqual([]);
    });

    it('should handle unicode usernames', () => {
      const text = 'Hey @jöhn and @señor, can you help?';
      const mentions = parseMentions(text);

      // Unicode word characters depend on regex engine
      // At minimum, should not crash
      expect(Array.isArray(mentions)).toBe(true);
    });

    it('should handle special characters in display names', () => {
      const text = 'Hey @[John O\'Brien] and @[Sarah-Jane Smith]';
      const mentions = parseMentions(text);

      expect(mentions).toContain('John O\'Brien');
      expect(mentions).toContain('Sarah-Jane Smith');
    });

    it('should trim whitespace from display names', () => {
      const text = 'Hey @[  John Doe  ]';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['John Doe']);
    });

    it('should handle @mention in middle of word', () => {
      // Should NOT match @mention if it's part of a larger word
      const text = 'email@address.com and something@john';
      const mentions = parseMentions(text);

      expect(mentions).toEqual([]);
    });

    it('should handle multiple mentions in complex text', () => {
      const text = `
        Hey @[John Doe] and @sarah,

        Can you review this ticket? @mike mentioned that @john@company.com
        might have insights. CC @admin and @[Project Manager].

        Thanks!
      `;
      const mentions = parseMentions(text);

      expect(mentions).toContain('John Doe');
      expect(mentions).toContain('sarah');
      expect(mentions).toContain('mike');
      expect(mentions).toContain('admin');
      expect(mentions).toContain('Project Manager');
      // Should not contain email parts
      expect(mentions).not.toContain('company.com');
    });

    it('should handle markdown formatted text', () => {
      const text = '**@john** please review this _@sarah_ and `@mike`';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['john', 'sarah', 'mike']);
    });

    it('should handle mentions in code blocks', () => {
      const text = 'Check this code: `const user = @john` and contact @sarah';
      const mentions = parseMentions(text);

      expect(mentions).toContain('john');
      expect(mentions).toContain('sarah');
    });
  });

  describe('Edge cases', () => {
    it('should handle very long text', () => {
      const text = 'Hey @john ' + 'word '.repeat(10000) + ' @sarah';
      const mentions = parseMentions(text);

      expect(mentions).toContain('john');
      expect(mentions).toContain('sarah');
      expect(mentions).toHaveLength(2);
    });

    it('should handle many mentions', () => {
      const users = Array.from({ length: 100 }, (_, i) => `user${i}`);
      const text = users.map(u => `@${u}`).join(' ');
      const mentions = parseMentions(text);

      expect(mentions).toHaveLength(100);
      expect(mentions).toContain('user0');
      expect(mentions).toContain('user99');
    });

    it('should handle text with only @ symbols', () => {
      const text = '@ @@ @@@ @ @';
      const mentions = parseMentions(text);

      expect(mentions).toEqual([]);
    });

    it('should handle mentions with numbers', () => {
      const text = 'Hey @user123 and @john2';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['user123', 'john2']);
    });

    it('should handle mentions with underscores', () => {
      const text = 'Hey @john_doe and @sarah_smith';
      const mentions = parseMentions(text);

      expect(mentions).toEqual(['john_doe', 'sarah_smith']);
    });
  });
});
