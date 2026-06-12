/**
 * Sample data for email template preview rendering.
 * Maps template names to realistic placeholder values for all known {{variables}}.
 */

// Inline styles mirror the runtime renderers in ticketEmailSubscriber.ts /
// projectEmailSubscriber.ts so the preview matches what real recipients see.
const CHANGE_LIST_STYLE = 'margin:0;padding:0;list-style:none;';
const CHANGE_ITEM_STYLE = 'margin:0 0 10px 0;padding:0;';
const CHANGE_FIELD_LABEL_STYLE = 'font-weight:600;color:#1f2933;';
const CHANGE_OLD_VALUE_STYLE = 'color:#94595d;text-decoration:line-through;word-break:break-word;';
const CHANGE_NEW_VALUE_STYLE = 'color:#0a7c3c;font-weight:600;word-break:break-word;';
const CHANGE_SINGLE_VALUE_STYLE = 'color:#1f2933;word-break:break-word;';
const CHANGE_SECTION_STYLE = 'margin:0 0 14px 0;padding:0 0 12px 0;border-bottom:1px solid rgba(146,64,14,0.15);';
const CHANGE_SECTION_LAST_STYLE = 'margin:0;padding:0;';
const CHANGE_SECTION_HEADER_STYLE = 'font-size:13px;color:#92400e;font-weight:600;margin:0 0 8px 0;';
const CHANGE_SECTION_TIMESTAMP_STYLE = 'color:#9a6c1f;font-weight:500;';

function renderSampleChangeItem(field: string, oldValue: string | null, newValue: string): string {
  const fieldHtml = `<div style="${CHANGE_FIELD_LABEL_STYLE}">${field}</div>`;
  if (oldValue === null) {
    return `<li style="${CHANGE_ITEM_STYLE}">${fieldHtml}<div style="${CHANGE_SINGLE_VALUE_STYLE}">${newValue}</div></li>`;
  }
  return `<li style="${CHANGE_ITEM_STYLE}">${fieldHtml}<div style="${CHANGE_OLD_VALUE_STYLE}">${oldValue}</div><div style="${CHANGE_NEW_VALUE_STYLE}">${newValue}</div></li>`;
}

function renderSampleChangeSection(
  updater: string,
  timestamp: string,
  items: string[],
  isLast: boolean,
): string {
  const sectionStyle = isLast ? CHANGE_SECTION_LAST_STYLE : CHANGE_SECTION_STYLE;
  const header = `<div style="${CHANGE_SECTION_HEADER_STYLE}">${updater} <span style="${CHANGE_SECTION_TIMESTAMP_STYLE}">· ${timestamp}</span></div>`;
  const list = `<ul style="${CHANGE_LIST_STYLE}">${items.join('')}</ul>`;
  return `<div style="${sectionStyle}">${header}${list}</div>`;
}

const SAMPLE_TICKET_CHANGES_HTML = [
  renderSampleChangeSection(
    'John Doe',
    'May 12, 2026, 3:04 PM EDT',
    [
      renderSampleChangeItem('Title', 'Printer offline on 3rd floor', 'Printer not working on 3rd floor — toner replacement needed'),
      renderSampleChangeItem('Priority', 'Medium', 'High'),
    ],
    false,
  ),
  renderSampleChangeSection(
    'Jane Smith',
    'May 12, 2026, 3:09 PM EDT',
    [
      renderSampleChangeItem('Status', 'New', 'In Progress'),
      renderSampleChangeItem('Assigned To', 'Unassigned', 'Jane Smith'),
    ],
    true,
  ),
].join('');

const SAMPLE_PROJECT_CHANGES_HTML = renderSampleChangeSection(
  'John Doe',
  'May 12, 2026, 3:04 PM EDT',
  [
    renderSampleChangeItem('Project Name', 'Q2 Rollout', 'Q2 Rollout — Phase 1'),
    renderSampleChangeItem('Status', 'Planning', 'In Progress'),
    renderSampleChangeItem('End Date', 'Jun 30, 2026', 'Jul 15, 2026'),
  ],
  true,
);

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
    'ticket.id': 'TCK-1234',
    'ticket.ticketNumber': 'TCK-1234',
    'ticket.title': 'Printer not working on 3rd floor',
    'ticket.description': 'Toner is jammed and red error light is on. Floor manager has been notified.',
    'ticket.priority': 'High',
    'ticket.priorityColor': '#dc2626',
    'ticket.status': 'In Progress',
    'ticket.metaLine': 'Ticket #TCK-1234 · High Priority · In Progress',
    'ticket.clientName': 'Acme Corporation',
    'ticket.updatedBy': 'John Doe',
    'ticket.assignedToName': 'Jane Smith',
    'ticket.assignedToEmail': 'jane.smith@example.com',
    'ticket.assignedDetails': 'Jane Smith (jane.smith@example.com)',
    'ticket.requesterName': 'John Doe',
    'ticket.requesterEmail': 'john.doe@acme.com',
    'ticket.requesterPhone': '+1 (555) 010-1234',
    'ticket.requesterContact': 'john.doe@acme.com · +1 (555) 010-1234',
    'ticket.requesterDetails': 'John Doe · john.doe@acme.com · +1 (555) 010-1234',
    'ticket.board': 'Help Desk',
    'ticket.category': 'Hardware',
    'ticket.subcategory': 'Printer',
    'ticket.categoryDetails': 'Hardware / Printer',
    'ticket.locationSummary': 'Acme HQ • 100 Main St, Springfield, IL 62701 US',
    'ticket.url': 'https://app.example.com/msp/tickets/sample-ticket-id',
    'ticket.changes': SAMPLE_TICKET_CHANGES_HTML,
    currentYear: String(new Date().getFullYear()),
    companyName: 'Alga PSA',
  },
  'ticket-created-client': {
    'ticket.id': 'TCK-1234',
    'ticket.ticketNumber': 'TCK-1234',
    'ticket.title': 'Printer not working on 3rd floor',
    'ticket.description': 'Toner is jammed and red error light is on. Floor manager has been notified.',
    'ticket.priority': 'High',
    'ticket.priorityColor': '#dc2626',
    'ticket.status': 'New',
    'ticket.metaLine': 'Ticket #TCK-1234 · High Priority · New',
    'ticket.clientName': 'Acme Corporation',
    'ticket.assignedToName': 'Jane Smith',
    'ticket.url': 'https://portal.example.com/client-portal/tickets/sample-ticket-id',
    currentYear: String(new Date().getFullYear()),
    companyName: 'Alga PSA',
  },
  'ticket-updated-client': {
    'ticket.id': 'TCK-1234',
    'ticket.ticketNumber': 'TCK-1234',
    'ticket.title': 'Printer not working on 3rd floor',
    'ticket.priority': 'High',
    'ticket.priorityColor': '#dc2626',
    'ticket.status': 'In Progress',
    'ticket.metaLine': 'Ticket #TCK-1234 · High Priority · In Progress',
    'ticket.clientName': 'Acme Corporation',
    'ticket.assignedToName': 'Jane Smith',
    'ticket.url': 'https://portal.example.com/client-portal/tickets/sample-ticket-id',
    'ticket.changes': SAMPLE_TICKET_CHANGES_HTML,
    currentYear: String(new Date().getFullYear()),
    companyName: 'Alga PSA',
  },
  'project-updated': {
    'project.id': 'PRJ-0042',
    'project.name': 'Q2 Rollout',
    'project.status': 'In Progress',
    'project.updatedBy': 'John Doe',
    'project.url': 'https://app.example.com/msp/projects/sample-project-id',
    'project.changes': SAMPLE_PROJECT_CHANGES_HTML,
    currentYear: String(new Date().getFullYear()),
    companyName: 'Alga PSA',
  },
  'project-closed': {
    'project.id': 'PRJ-0042',
    'project.name': 'Q2 Rollout',
    'project.status': 'Closed',
    'project.closedBy': 'John Doe',
    'project.url': 'https://app.example.com/msp/projects/sample-project-id',
    'project.changes': SAMPLE_PROJECT_CHANGES_HTML,
    currentYear: String(new Date().getFullYear()),
    companyName: 'Alga PSA',
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
  // Match both {{var}} and {{{var}}} (raw-HTML form).
  const regex = /\{{2,3}([^{}]+)\}{2,3}/g;
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
