import { describe, it, expect } from 'vitest';

/**
 * Unit tests for email template sample data generation.
 *
 * These functions are used to provide realistic placeholder values
 * for email template preview rendering and test email sending.
 *
 * The functions are replicated from packages/notifications/src/lib/templateSampleData.ts
 * to keep unit tests self-contained (matching codebase convention).
 */

// === Replicated functions from templateSampleData.ts ===

const TEMPLATE_SAMPLE_DATA: Record<string, Record<string, string>> = {
  'password-reset': {
    userName: 'John Doe',
    email: 'john.doe@example.com',
    resetLink: 'https://app.example.com/auth/reset-password?token=sample-token',
    expirationTime: '24 hours',
    supportEmail: 'support@example.com',
    clientName: 'Acme Corporation',
    currentYear: String(new Date().getFullYear()),
  },
  'email-verification': {
    email: 'john.doe@example.com',
    verificationUrl: 'https://app.example.com/auth/verify?token=sample-token',
    expirationTime: '48 hours',
  },
  'portal-invitation': {
    invitedEmail: 'jane.smith@client.com',
    inviterName: 'John Doe',
    clientName: 'Acme Corporation',
    invitationLink: 'https://app.example.com/auth/accept-invite?token=sample-token',
    expirationTime: '7 days',
  },
  'credit-expiration': {
    'client.name': 'Acme Corporation',
    'credits.totalAmount': '$2,500.00',
    'credits.daysRemaining': '30',
  },
  'sla-breach': {
    ticketNumber: 'TCK-1234',
    ticketTitle: 'Network connectivity issue in Building A',
    'ticket.title': 'Network connectivity issue in Building A',
  },
  'survey-request': {
    tenant_name: 'Acme IT Support',
    ticket_number: 'TCK-1234',
    technician_name: 'John Doe',
    survey_url: 'https://app.example.com/surveys/respond/sample-token',
  },
};

function getTemplateSampleData(templateName: string): Record<string, string> {
  return TEMPLATE_SAMPLE_DATA[templateName] ?? {};
}

function extractVariablesFromTemplate(content: string): Record<string, string> {
  const variables: Record<string, string> = {};
  const regex = /\{\{([^}]+)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const varName = match[1].trim();
    // Skip block helpers like {{#if ...}}, {{/if}}, {{else}}
    if (varName.startsWith('#') || varName.startsWith('/') || varName === 'else') {
      continue;
    }
    if (!variables[varName]) {
      variables[varName] = formatVariableAsSample(varName);
    }
  }

  return variables;
}

function formatVariableAsSample(varName: string): string {
  const parts = varName
    .split('.')
    .flatMap(part =>
      part.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[_\s]+/)
    );

  return parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function getSampleDataForPreview(
  templateName: string,
  htmlContent: string,
  subject?: string,
): Record<string, string> {
  const predefined = getTemplateSampleData(templateName);
  const extracted = extractVariablesFromTemplate(
    (subject ?? '') + ' ' + htmlContent
  );
  return { ...extracted, ...predefined };
}

// === Tests ===

describe('templateSampleData', () => {
  describe('getTemplateSampleData', () => {
    it('should return sample data for known template "password-reset"', () => {
      const data = getTemplateSampleData('password-reset');
      expect(data).toBeDefined();
      expect(data.userName).toBe('John Doe');
      expect(data.email).toBe('john.doe@example.com');
      expect(data.resetLink).toContain('https://');
      expect(data.expirationTime).toBeTruthy();
    });

    it('should return sample data for known template "email-verification"', () => {
      const data = getTemplateSampleData('email-verification');
      expect(data.email).toBeDefined();
      expect(data.verificationUrl).toContain('https://');
    });

    it('should return sample data for known template "portal-invitation"', () => {
      const data = getTemplateSampleData('portal-invitation');
      expect(data.invitedEmail).toBeDefined();
      expect(data.inviterName).toBeDefined();
      expect(data.clientName).toBeDefined();
    });

    it('should return sample data for known template "sla-breach"', () => {
      const data = getTemplateSampleData('sla-breach');
      expect(data.ticketNumber).toBeDefined();
      expect(data.ticketTitle).toBeDefined();
      expect(data['ticket.title']).toBeDefined();
    });

    it('should return empty object for unknown template', () => {
      const data = getTemplateSampleData('unknown-template-xyz');
      expect(data).toEqual({});
    });

    it('should return sample data for "credit-expiration" with nested keys', () => {
      const data = getTemplateSampleData('credit-expiration');
      expect(data['client.name']).toBe('Acme Corporation');
      expect(data['credits.totalAmount']).toBeTruthy();
      expect(data['credits.daysRemaining']).toBeTruthy();
    });

    it('should return sample data for "survey-request"', () => {
      const data = getTemplateSampleData('survey-request');
      expect(data.tenant_name).toBeDefined();
      expect(data.ticket_number).toBeDefined();
      expect(data.technician_name).toBeDefined();
      expect(data.survey_url).toContain('https://');
    });
  });

  describe('extractVariablesFromTemplate', () => {
    it('should extract simple variables', () => {
      const vars = extractVariablesFromTemplate('Hello {{name}}, welcome to {{company}}!');
      expect(Object.keys(vars)).toHaveLength(2);
      expect(vars).toHaveProperty('name');
      expect(vars).toHaveProperty('company');
    });

    it('should extract dotted variables', () => {
      const vars = extractVariablesFromTemplate('{{user.firstName}} {{user.lastName}}');
      expect(vars).toHaveProperty('user.firstName');
      expect(vars).toHaveProperty('user.lastName');
    });

    it('should return empty object for no variables', () => {
      const vars = extractVariablesFromTemplate('No variables here');
      expect(vars).toEqual({});
    });

    it('should handle empty string', () => {
      const vars = extractVariablesFromTemplate('');
      expect(vars).toEqual({});
    });

    it('should deduplicate repeated variables', () => {
      const vars = extractVariablesFromTemplate('{{name}} said hello to {{name}}');
      expect(Object.keys(vars)).toHaveLength(1);
      expect(vars).toHaveProperty('name');
    });

    it('should generate human-readable sample values from variable names', () => {
      const vars = extractVariablesFromTemplate('{{userName}} at {{companyName}}');
      expect(vars.userName).toBe('User Name');
      expect(vars.companyName).toBe('Company Name');
    });

    it('should handle dotted variable names in sample values', () => {
      const vars = extractVariablesFromTemplate('{{ticket.title}}');
      expect(vars['ticket.title']).toBe('Ticket Title');
    });

    it('should skip {{#if}}, {{/if}}, and {{else}} block helpers', () => {
      const vars = extractVariablesFromTemplate(
        '{{#if supportEmail}}Contact {{supportEmail}}{{/if}} {{else}} {{name}}'
      );
      expect(vars).not.toHaveProperty('#if supportEmail');
      expect(vars).not.toHaveProperty('/if');
      expect(vars).not.toHaveProperty('else');
      expect(vars).toHaveProperty('supportEmail');
      expect(vars).toHaveProperty('name');
      expect(Object.keys(vars)).toHaveLength(2);
    });
  });

  describe('getSampleDataForPreview', () => {
    it('should use predefined data when template name matches', () => {
      const data = getSampleDataForPreview(
        'password-reset',
        '<p>Hello {{userName}}</p>',
        'Reset your password'
      );
      expect(data.userName).toBe('John Doe');
    });

    it('should fall back to extracted variables for unknown templates', () => {
      const data = getSampleDataForPreview(
        'unknown-custom-template',
        '<p>Hello {{firstName}}, your order {{orderId}} is ready.</p>',
        'Order {{orderId}} ready'
      );
      expect(data.firstName).toBe('First Name');
      expect(data.orderId).toBe('Order Id');
    });

    it('should merge predefined data with extracted variables', () => {
      const data = getSampleDataForPreview(
        'password-reset',
        '<p>Hello {{userName}}, {{customGreeting}}</p>',
        'Reset password'
      );
      expect(data.userName).toBe('John Doe');
      expect(data.customGreeting).toBe('Custom Greeting');
    });

    it('should extract variables from subject too', () => {
      const data = getSampleDataForPreview(
        'unknown-template',
        '<p>Body content</p>',
        'Hello {{recipientName}}'
      );
      expect(data.recipientName).toBe('Recipient Name');
    });
  });

  describe('formatVariableAsSample', () => {
    it('should convert camelCase to title case', () => {
      expect(formatVariableAsSample('userName')).toBe('User Name');
    });

    it('should handle dotted paths', () => {
      expect(formatVariableAsSample('user.firstName')).toBe('User First Name');
    });

    it('should handle snake_case', () => {
      expect(formatVariableAsSample('ticket_number')).toBe('Ticket Number');
    });

    it('should handle simple names', () => {
      expect(formatVariableAsSample('name')).toBe('Name');
    });

    it('should handle deeply nested paths', () => {
      expect(formatVariableAsSample('credits.totalAmount')).toBe('Credits Total Amount');
    });
  });
});
