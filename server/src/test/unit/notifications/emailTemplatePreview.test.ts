import { describe, it, expect } from 'vitest';

/**
 * Unit tests for email template preview variable replacement.
 *
 * This function is used client-side in EmailTemplates.tsx to render
 * HTML email templates with sample data in a sandboxed iframe preview.
 * It supports both simple ({{name}}) and dotted ({{user.name}}) variables.
 */

// Replicate the replaceTemplateVariables function from EmailTemplates.tsx
function replaceTemplateVariables(
  content: string,
  data: Record<string, string>
): string {
  // Process {{#if condition}}...{{/if}} blocks first
  let result = content.replace(
    /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, _condition, blockContent) => blockContent
  );

  // Then replace simple {{variable}} placeholders
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    return trimmedKey in data ? data[trimmedKey] : match;
  });

  return result;
}

describe('replaceTemplateVariables (preview)', () => {
  it('should replace simple variables', () => {
    const result = replaceTemplateVariables('Hello {{name}}!', { name: 'John' });
    expect(result).toBe('Hello John!');
  });

  it('should replace multiple variables', () => {
    const result = replaceTemplateVariables(
      '{{greeting}} {{name}}, welcome to {{company}}',
      { greeting: 'Hi', name: 'Jane', company: 'Acme Corp' }
    );
    expect(result).toBe('Hi Jane, welcome to Acme Corp');
  });

  it('should replace dotted variables', () => {
    const result = replaceTemplateVariables(
      '{{user.firstName}} {{user.lastName}}',
      { 'user.firstName': 'John', 'user.lastName': 'Doe' }
    );
    expect(result).toBe('John Doe');
  });

  it('should preserve unmatched placeholders', () => {
    const result = replaceTemplateVariables(
      '{{known}} and {{unknown}}',
      { known: 'value' }
    );
    expect(result).toBe('value and {{unknown}}');
  });

  it('should handle empty data', () => {
    const result = replaceTemplateVariables('Hello {{name}}', {});
    expect(result).toBe('Hello {{name}}');
  });

  it('should handle empty content', () => {
    const result = replaceTemplateVariables('', { name: 'John' });
    expect(result).toBe('');
  });

  it('should replace repeated variables', () => {
    const result = replaceTemplateVariables(
      '{{name}} said hello to {{name}}',
      { name: 'John' }
    );
    expect(result).toBe('John said hello to John');
  });

  it('should handle variables with spaces (trimmed)', () => {
    const result = replaceTemplateVariables(
      'Hello {{ name }}!',
      { name: 'John' }
    );
    expect(result).toBe('Hello John!');
  });

  it('should handle HTML content with variables', () => {
    const html = '<h1>Hello {{userName}}</h1><p>Click <a href="{{resetLink}}">here</a></p>';
    const result = replaceTemplateVariables(html, {
      userName: 'Jane',
      resetLink: 'https://example.com/reset',
    });
    expect(result).toBe('<h1>Hello Jane</h1><p>Click <a href="https://example.com/reset">here</a></p>');
  });

  it('should not replace single-brace patterns', () => {
    const result = replaceTemplateVariables(
      '{name} is not a variable',
      { name: 'John' }
    );
    expect(result).toBe('{name} is not a variable');
  });

  it('should render {{#if}} blocks by showing their content', () => {
    const result = replaceTemplateVariables(
      'Hello {{name}}. {{#if supportEmail}}Contact {{supportEmail}}{{/if}}',
      { name: 'John', supportEmail: 'help@example.com' }
    );
    expect(result).toBe('Hello John. Contact help@example.com');
  });

  it('should handle {{#if}} blocks with no matching data (still shows content in preview)', () => {
    const result = replaceTemplateVariables(
      '{{#if ticketUrl}}<a href="{{ticketUrl}}">View</a>{{/if}}',
      {}
    );
    // Block content is shown, but {{ticketUrl}} is preserved since no data for it
    expect(result).toBe('<a href="{{ticketUrl}}">View</a>');
  });

  it('should handle multiple {{#if}} blocks', () => {
    const result = replaceTemplateVariables(
      '{{#if phone}}Call {{phone}}{{/if}} or {{#if email}}email {{email}}{{/if}}',
      { phone: '555-1234', email: 'test@example.com' }
    );
    expect(result).toBe('Call 555-1234 or email test@example.com');
  });
});
