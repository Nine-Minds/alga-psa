/**
 * Sample data for email template preview rendering.
 * Maps template names to realistic placeholder values for all known {{variables}}.
 */

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
    'client.id': 'client-001',
    'client.name': 'Acme Corporation',
    'credits.totalAmount': '$2,500.00',
    'credits.expirationDate': 'March 31, 2026',
    'credits.daysRemaining': '30',
    'credits.url': 'https://app.example.com/billing/credits?client=client-001',
  },
  'sla-breach': {
    recipientName: 'John Doe',
    ticketNumber: 'TCK-1234',
    ticketTitle: 'Network connectivity issue in Building A',
    clientName: 'Acme Corporation',
    priorityName: 'High',
    priority: 'High',
    policyName: 'Critical Response SLA',
    slaType: 'Response',
    thresholdPercent: '100',
    remainingTime: '0 minutes',
    timeRemaining: '0 minutes',
    timeOverdue: '15 minutes',
    dueAt: new Date().toISOString(),
    ticketUrl: '/msp/tickets/sample-ticket-id',
    'ticket.id': 'TCK-1234',
    'ticket.title': 'Network connectivity issue in Building A',
    'ticket.url': '/msp/tickets/sample-ticket-id',
    'sla.name': 'Critical Response SLA',
    'sla.target': '1 hour',
    'sla.elapsed': '1 hour 15 minutes',
    'user.firstName': 'John',
    'user.lastName': 'Doe',
  },
  'sla-warning': {
    recipientName: 'John Doe',
    ticketNumber: 'TCK-1234',
    ticketTitle: 'Network connectivity issue in Building A',
    clientName: 'Acme Corporation',
    priorityName: 'High',
    priority: 'High',
    policyName: 'Standard Resolution SLA',
    slaType: 'Resolution',
    thresholdPercent: '75',
    remainingTime: '30 minutes',
    timeRemaining: '30 minutes',
    timeOverdue: '0 minutes',
    dueAt: new Date().toISOString(),
    ticketUrl: '/msp/tickets/sample-ticket-id',
    'ticket.id': 'TCK-1234',
    'ticket.title': 'Network connectivity issue in Building A',
    'ticket.url': '/msp/tickets/sample-ticket-id',
    'sla.name': 'Standard Resolution SLA',
    'sla.target': '4 hours',
    'sla.elapsed': '3 hours',
    'user.firstName': 'John',
    'user.lastName': 'Doe',
  },
  'ticket-created': {
    body: '<p>A new ticket has been created and assigned to you.</p>',
    'ticket.ticketNumber': 'TCK-1234',
    'ticket.title': 'Printer not working on 3rd floor',
  },
  'ticket-updated': {
    body: '<p>Ticket TCK-1234 has been updated.</p>',
    'ticket.ticketNumber': 'TCK-1234',
    'ticket.title': 'Printer not working on 3rd floor',
  },
  'ticket-closed': {
    body: '<p>Your ticket has been closed.</p><p>Resolution: Resolved</p>',
    'ticket.ticketNumber': 'TCK-1234',
    'ticket.title': 'Printer not working on 3rd floor',
    'ticket.resolutionCode': 'Resolved',
    'ticket.resolutionText': 'Replaced printer toner cartridge',
  },
  'ticket-comment': {
    body: '<p>A new comment has been added to your ticket.</p>',
    'ticket.ticketNumber': 'TCK-1234',
    'ticket.title': 'Printer not working on 3rd floor',
  },
  'survey-request': {
    tenant_name: 'Acme IT Support',
    ticket_number: 'TCK-1234',
    ticket_subject: 'Printer not working on 3rd floor',
    technician_name: 'John Doe',
    survey_url: 'https://app.example.com/surveys/respond/sample-token',
    rating_buttons_html: '<a href="#">1</a> <a href="#">2</a> <a href="#">3</a> <a href="#">4</a> <a href="#">5</a>',
    rating_links_text: '1 ★ | 2 ★★ | 3 ★★★ | 4 ★★★★ | 5 ★★★★★',
    rating_scale: '5',
    rating_type: 'stars',
    prompt_text: 'How would you rate your support experience?',
    comment_prompt: 'Share additional feedback (optional).',
    thank_you_text: 'Thank you for helping us improve!',
    contact_name: 'Jane Smith',
    company_name: 'Acme Corporation',
  },
  'escalation': {
    ticketNumber: 'TCK-1234',
    ticketTitle: 'Critical server outage',
    escalationLevel: '2',
    escalationReason: 'SLA breach - response time exceeded',
    assigneeName: 'John Doe',
    'ticket.id': 'TCK-1234',
    'ticket.title': 'Critical server outage',
    'user.firstName': 'John',
    'user.lastName': 'Doe',
  },
};

/**
 * Get sample data for a specific template name.
 * Falls back to extracting {{variables}} from HTML if the template name is not recognized.
 */
export function getTemplateSampleData(templateName: string): Record<string, string> {
  return TEMPLATE_SAMPLE_DATA[templateName] ?? {};
}

/**
 * Extract {{variable}} placeholders from a template string and generate
 * sample values using the variable name itself as the value.
 * Used as a fallback when no predefined sample data exists.
 */
export function extractVariablesFromTemplate(content: string): Record<string, string> {
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
      // Generate a human-readable sample value from the variable name
      variables[varName] = formatVariableAsSample(varName);
    }
  }

  return variables;
}

/**
 * Convert a variable name like "user.firstName" to a sample value like "Sample First Name"
 */
function formatVariableAsSample(varName: string): string {
  // Split on dots and camelCase
  const parts = varName
    .split('.')
    .flatMap(part =>
      part.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[_\s]+/)
    );

  return parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Get the best available sample data for a template.
 * Uses predefined data if available, otherwise extracts from template content.
 */
export function getSampleDataForPreview(
  templateName: string,
  htmlContent: string,
  subject?: string,
): Record<string, string> {
  const predefined = getTemplateSampleData(templateName);
  const extracted = extractVariablesFromTemplate(
    (subject ?? '') + ' ' + htmlContent
  );

  // Merge: predefined values take priority over auto-extracted
  return { ...extracted, ...predefined };
}
