const {
  SURVEY_TEMPLATE_NAME,
  SURVEY_SUBTYPE_NAME,
  SURVEY_CATEGORY_NAME,
  SURVEY_TEMPLATE_TRANSLATIONS,
  buildSurveyHtmlTemplate,
  buildSurveyTextTemplate,
} = require('../../migrations/utils/surveyEmailTemplates.cjs');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // Get the first tenant from the tenants table
  const tenant = await knex('tenants').first('tenant');
  if (!tenant) {
    throw new Error('No tenant found in tenants table');
  }

  const requiredSubtypeNames = [
    'Ticket Created',
    'Ticket Updated',
    'Ticket Closed',
    'Invoice Generated',
    'Invoice Email',
    'Payment Received',
    'Payment Overdue',
    'Project Created',
    'Task Updated',
    'Milestone Completed',
    'Time Entry Submitted',
    'Time Entry Approved',
    'Time Entry Rejected'
  ];

  // Get subtypes for reference
  const subtypes = await knex('notification_subtypes')
    .select('id', 'name')
    .whereIn('name', requiredSubtypeNames);

  if (subtypes.length === 0) {
    throw new Error('No notification subtypes found. Make sure 20241220_add_default_notification_settings has been run.');
  }

  const subtypeIdByName = subtypes.reduce((acc, subtype) => {
    acc[subtype.name] = subtype.id;
    return acc;
  }, {});

  const missingSubtypeNames = requiredSubtypeNames.filter((name) => !subtypeIdByName[name]);
  if (missingSubtypeNames.length > 0) {
    console.warn(
      `[seed 68_add_notification_templates] Missing notification subtypes (will skip related templates): ${missingSubtypeNames.join(', ')}`
    );
  }

  // Clean up any existing notification templates (but keep authentication templates)
  await knex('tenant_email_templates').del();

  // Delete only notification-related system templates, preserve authentication templates
  const authTemplateNames = [
    'email-verification',
    'password-reset',
    'portal-invitation',
    'tenant-recovery',
    'no-account-found',
    'SURVEY_TICKET_CLOSED'
  ];
  await knex('system_email_templates')
    .whereNotIn('name', authTemplateNames)
    .del();

  // Insert system-wide default templates
  const systemTemplatesPayload = [
    // Ticket templates
    {
      name: 'ticket-created',
      language_code: 'en',
      subject: 'New Ticket • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: subtypes.find(s => s.name === 'Ticket Created')?.id,
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">New Ticket Created</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">A new ticket has been logged for <strong>{{ticket.clientName}}</strong>. Review the summary below and follow the link to take action.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priority</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Created</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.createdAt}} · {{ticket.createdBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigned To</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Requester</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Board</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Category</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Location</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
                  <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Description</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.description}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">View Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Keeping teams aligned</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
New Ticket Created for {{ticket.clientName}}

{{ticket.metaLine}}
Created: {{ticket.createdAt}} · {{ticket.createdBy}}

Priority: {{ticket.priority}}
Status: {{ticket.status}}
Assigned To: {{ticket.assignedDetails}}
Requester: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Category: {{ticket.categoryDetails}}
Location: {{ticket.locationSummary}}

Description:
{{ticket.description}}

View ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-updated',
      language_code: 'en',
      subject: 'Ticket Updated • {{ticket.title}} ({{ticket.priority}})',
      notification_subtype_id: subtypes.find(s => s.name === 'Ticket Updated')?.id,
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Updated</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">A ticket for <strong>{{ticket.clientName}}</strong> has been updated. Review the changes below.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Priority</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:{{ticket.priorityColor}};color:#ffffff;font-weight:600;">{{ticket.priority}}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.status}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Updated By</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.updatedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigned To</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Requester</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Board</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Category</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Location</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#fff9e6;border:1px solid #ffe4a3;">
                  <div style="font-weight:600;color:#92400e;margin-bottom:8px;">Changes Made</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.changes}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#8A4DEA;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">View Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA • Keeping teams aligned</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Updated

{{ticket.metaLine}}
Updated By: {{ticket.updatedBy}}

Priority: {{ticket.priority}}
Status: {{ticket.status}}
Assigned To: {{ticket.assignedDetails}}
Requester: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Category: {{ticket.categoryDetails}}
Location: {{ticket.locationSummary}}

Changes Made:
{{ticket.changes}}

View ticket: {{ticket.url}}
      `
    },
    {
      name: 'ticket-closed',
      language_code: 'en',
      subject: 'Ticket Closed • {{ticket.title}}',
      notification_subtype_id: subtypes.find(s => s.name === 'Ticket Closed')?.id,
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#10b981,#059669);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Closed</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">A ticket for <strong>{{ticket.clientName}}</strong> has been resolved and closed. Review the resolution details below.</p>
                <div style="margin-bottom:24px;">
                  <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(16,185,129,0.12);color:#047857;font-size:12px;font-weight:600;letter-spacing:0.02em;">Ticket #{{ticket.id}}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Status</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:#10b981;color:#ffffff;font-weight:600;">Closed</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Closed By</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.closedBy}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigned To</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.assignedToName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.assignedToEmail}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Requester</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                      <div style="font-weight:600;">{{ticket.requesterName}}</div>
                      <div style="color:#667085;font-size:13px;">{{ticket.requesterContact}}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Board</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.board}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Category</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.categoryDetails}}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0;font-weight:600;color:#475467;">Location</td>
                    <td style="padding:12px 0;">{{ticket.locationSummary}}</td>
                  </tr>
                </table>
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0;">
                  <div style="font-weight:600;color:#047857;margin-bottom:8px;">Resolution</div>
                  <div style="color:#475467;line-height:1.5;">{{ticket.resolution}}</div>
                </div>
                <a href="{{ticket.url}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">View Ticket</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f0fdf4;color:#047857;font-size:12px;text-align:center;">Powered by Alga PSA • Keeping teams aligned</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
      `,
      text_content: `
Ticket Closed

{{ticket.metaLine}}
Closed By: {{ticket.closedBy}}

Status: Closed
Assigned To: {{ticket.assignedDetails}}
Requester: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Category: {{ticket.categoryDetails}}
Location: {{ticket.locationSummary}}

Resolution:
{{ticket.resolution}}

View ticket: {{ticket.url}}
      `
    },

    // Invoice templates
    {
      name: 'invoice-generated',
      language_code: 'en',
      subject: 'New Invoice #{{invoice.number}}',
      notification_subtype_id: subtypes.find(s => s.name === 'Invoice Generated')?.id,
      html_content: `
        <h2>Invoice {{invoice.number}}</h2>
        <p>A new invoice has been generated for your review:</p>
        <div class="details">
          <p><strong>Invoice Number:</strong> {{invoice.number}}</p>
          <p><strong>Amount:</strong> {{invoice.amount}}</p>
          <p><strong>Due Date:</strong> {{invoice.dueDate}}</p>
          <p><strong>Client:</strong> {{invoice.clientName}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">View Invoice</a>
      `,
      text_content: `
Invoice {{invoice.number}}

A new invoice has been generated for your review:

Invoice Number: {{invoice.number}}
Amount: {{invoice.amount}}
Due Date: {{invoice.dueDate}}
Client: {{invoice.clientName}}

View invoice at: {{invoice.url}}
      `
    },
    {
      name: 'payment-received',
      language_code: 'en',
      subject: 'Payment Received: Invoice #{{invoice.number}}',
      notification_subtype_id: subtypes.find(s => s.name === 'Payment Received')?.id,
      html_content: `
        <h2>Payment Received</h2>
        <p>Payment has been received for invoice #{{invoice.number}}:</p>
        <div class="details">
          <p><strong>Invoice Number:</strong> {{invoice.number}}</p>
          <p><strong>Amount Paid:</strong> {{invoice.amountPaid}}</p>
          <p><strong>Payment Date:</strong> {{invoice.paymentDate}}</p>
          <p><strong>Payment Method:</strong> {{invoice.paymentMethod}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">View Invoice</a>
      `,
      text_content: `
Payment Received

Payment has been received for invoice #{{invoice.number}}:

Invoice Number: {{invoice.number}}
Amount Paid: {{invoice.amountPaid}}
Payment Date: {{invoice.paymentDate}}
Payment Method: {{invoice.paymentMethod}}

View invoice at: {{invoice.url}}
      `
    },
    {
      name: 'payment-overdue',
      language_code: 'en',
      subject: 'Payment Overdue: Invoice #{{invoice.number}}',
      notification_subtype_id: subtypes.find(s => s.name === 'Payment Overdue')?.id,
      html_content: `
        <h2>Payment Overdue</h2>
        <p>The payment for invoice #{{invoice.number}} is overdue:</p>
        <div class="details">
          <p><strong>Invoice Number:</strong> {{invoice.number}}</p>
          <p><strong>Amount Due:</strong> {{invoice.amountDue}}</p>
          <p><strong>Due Date:</strong> {{invoice.dueDate}}</p>
          <p><strong>Days Overdue:</strong> {{invoice.daysOverdue}}</p>
        </div>
        <a href="{{invoice.url}}" class="button">View Invoice</a>
      `,
      text_content: `
Payment Overdue

The payment for invoice #{{invoice.number}} is overdue:

Invoice Number: {{invoice.number}}
Amount Due: {{invoice.amountDue}}
Due Date: {{invoice.dueDate}}
Days Overdue: {{invoice.daysOverdue}}

View invoice at: {{invoice.url}}
      `
    },
    {
      name: 'invoice-email',
      language_code: 'en',
      subject: 'Invoice {{invoice.number}} from {{company.name}}',
      notification_subtype_id: subtypes.find(s => s.name === 'Invoice Email')?.id,
      html_content: `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
        <tr>
          <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Invoice</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">{{invoice.number}}</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">From {{company.name}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Dear {{recipient.name}},</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Please find attached your invoice from <strong>{{company.name}}</strong>.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">Invoice Number</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(138,77,234,0.12);color:#5b38b0;font-size:12px;font-weight:600;letter-spacing:0.02em;">{{invoice.number}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Amount Due</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">
                  <span style="font-size:18px;font-weight:700;color:#1f2933;">{{invoice.amount}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Invoice Date</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{invoice.invoiceDate}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">Due Date</td>
                <td style="padding:12px 0;">{{invoice.dueDate}}</td>
              </tr>
            </table>

            {{#if customMessage}}
            <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
              <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">Note from {{company.name}}</div>
              <div style="color:#475467;line-height:1.5;">{{customMessage}}</div>
            </div>
            {{/if}}

            <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">The invoice is attached to this email as a PDF. If you have any questions, please don't hesitate to contact us.</p>

            <p style="margin:16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Thank you for your business!</p>

            <p style="margin:16px 0 0 0;font-size:15px;color:#1f2933;line-height:1.5;">Best regards,<br><strong>{{company.name}}</strong></p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#f8f5ff;color:#5b38b0;font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
      `,
      text_content: `
Invoice {{invoice.number}} from {{company.name}}

Dear {{recipient.name}},

Please find attached your invoice from {{company.name}}.

Invoice Details:
- Invoice Number: {{invoice.number}}
- Amount Due: {{invoice.amount}}
- Invoice Date: {{invoice.invoiceDate}}
- Due Date: {{invoice.dueDate}}

{{#if customMessage}}
Note: {{customMessage}}
{{/if}}

The invoice is attached to this email as a PDF. If you have any questions, please don't hesitate to contact us.

Thank you for your business!

Best regards,
{{company.name}}
      `
    },

    // Project templates
    {
      name: 'project-created',
      language_code: 'en',
      subject: 'New Project Created: {{project.name}}',
      notification_subtype_id: subtypes.find(s => s.name === 'Project Created')?.id,
      html_content: `
        <h2>New Project Created</h2>
        <p>A new project has been created:</p>
        <div class="details">
          <p><strong>Project Name:</strong> {{project.name}}</p>
          <p><strong>Description:</strong> {{project.description}}</p>
          <p><strong>Start Date:</strong> {{project.startDate}}</p>
          <p><strong>Project Manager:</strong> {{project.manager}}</p>
        </div>
        <a href="{{project.url}}" class="button">View Project</a>
      `,
      text_content: `
New Project Created

A new project has been created:

Project Name: {{project.name}}
Description: {{project.description}}
Start Date: {{project.startDate}}
Project Manager: {{project.manager}}

View project at: {{project.url}}
      `
    },
    {
      name: 'task-updated',
      language_code: 'en',
      subject: 'Task Updated: {{task.name}}',
      notification_subtype_id: subtypes.find(s => s.name === 'Task Updated')?.id,
      html_content: `
        <h2>Task Updated</h2>
        <p>A task has been updated in project {{project.name}}:</p>
        <div class="details">
          <p><strong>Task Name:</strong> {{task.name}}</p>
          <p><strong>Status:</strong> {{task.status}}</p>
          <p><strong>Progress:</strong> {{task.progress}}%</p>
          <p><strong>Updated By:</strong> {{task.updatedBy}}</p>
        </div>
        <a href="{{task.url}}" class="button">View Task</a>
      `,
      text_content: `
Task Updated

A task has been updated in project {{project.name}}:

Task Name: {{task.name}}
Status: {{task.status}}
Progress: {{task.progress}}%
Updated By: {{task.updatedBy}}

View task at: {{task.url}}
      `
    },
    {
      name: 'milestone-completed',
      language_code: 'en',
      subject: 'Milestone Completed: {{milestone.name}}',
      notification_subtype_id: subtypes.find(s => s.name === 'Milestone Completed')?.id,
      html_content: `
        <h2>Milestone Completed</h2>
        <p>A milestone has been completed in project {{project.name}}:</p>
        <div class="details">
          <p><strong>Milestone:</strong> {{milestone.name}}</p>
          <p><strong>Completion Date:</strong> {{milestone.completedDate}}</p>
          <p><strong>Completed By:</strong> {{milestone.completedBy}}</p>
          <p><strong>Project Progress:</strong> {{project.progress}}%</p>
        </div>
        <a href="{{project.url}}" class="button">View Project</a>
      `,
      text_content: `
Milestone Completed

A milestone has been completed in project {{project.name}}:

Milestone: {{milestone.name}}
Completion Date: {{milestone.completedDate}}
Completed By: {{milestone.completedBy}}
Project Progress: {{project.progress}}%

View project at: {{project.url}}
      `
    },

    // Time Entry templates
    {
      name: 'time-entry-submitted',
      language_code: 'en',
      subject: 'Time Entry Submitted for Review',
      notification_subtype_id: subtypes.find(s => s.name === 'Time Entry Submitted')?.id,
      html_content: `
        <h2>Time Entry Submitted</h2>
        <p>A time entry has been submitted for review:</p>
        <div class="details">
          <p><strong>Submitted By:</strong> {{timeEntry.submittedBy}}</p>
          <p><strong>Date:</strong> {{timeEntry.date}}</p>
          <p><strong>Duration:</strong> {{timeEntry.duration}}</p>
          <p><strong>Project:</strong> {{timeEntry.project}}</p>
          <p><strong>Task:</strong> {{timeEntry.task}}</p>
        </div>
        <a href="{{timeEntry.url}}" class="button">Review Time Entry</a>
      `,
      text_content: `
Time Entry Submitted

A time entry has been submitted for review:

Submitted By: {{timeEntry.submittedBy}}
Date: {{timeEntry.date}}
Duration: {{timeEntry.duration}}
Project: {{timeEntry.project}}
Task: {{timeEntry.task}}

Review time entry at: {{timeEntry.url}}
      `
    },
    {
      name: 'time-entry-approved',
      language_code: 'en',
      subject: 'Time Entry Approved',
      notification_subtype_id: subtypes.find(s => s.name === 'Time Entry Approved')?.id,
      html_content: `
        <h2>Time Entry Approved</h2>
        <p>Your time entry has been approved:</p>
        <div class="details">
          <p><strong>Date:</strong> {{timeEntry.date}}</p>
          <p><strong>Duration:</strong> {{timeEntry.duration}}</p>
          <p><strong>Project:</strong> {{timeEntry.project}}</p>
          <p><strong>Task:</strong> {{timeEntry.task}}</p>
          <p><strong>Approved By:</strong> {{timeEntry.approvedBy}}</p>
        </div>
        <a href="{{timeEntry.url}}" class="button">View Time Entry</a>
      `,
      text_content: `
Time Entry Approved

Your time entry has been approved:

Date: {{timeEntry.date}}
Duration: {{timeEntry.duration}}
Project: {{timeEntry.project}}
Task: {{timeEntry.task}}
Approved By: {{timeEntry.approvedBy}}

View time entry at: {{timeEntry.url}}
      `
    },
    {
      name: 'time-entry-rejected',
      language_code: 'en',
      subject: 'Time Entry Rejected',
      notification_subtype_id: subtypes.find(s => s.name === 'Time Entry Rejected')?.id,
      html_content: `
        <h2>Time Entry Rejected</h2>
        <p>Your time entry has been rejected:</p>
        <div class="details">
          <p><strong>Date:</strong> {{timeEntry.date}}</p>
          <p><strong>Duration:</strong> {{timeEntry.duration}}</p>
          <p><strong>Project:</strong> {{timeEntry.project}}</p>
          <p><strong>Task:</strong> {{timeEntry.task}}</p>
          <p><strong>Rejected By:</strong> {{timeEntry.rejectedBy}}</p>
          <p><strong>Reason:</strong> {{timeEntry.rejectionReason}}</p>
        </div>
        <a href="{{timeEntry.url}}" class="button">View Time Entry</a>
      `,
      text_content: `
Time Entry Rejected

Your time entry has been rejected:

Date: {{timeEntry.date}}
Duration: {{timeEntry.duration}}
Project: {{timeEntry.project}}
Task: {{timeEntry.task}}
Rejected By: {{timeEntry.rejectedBy}}
Reason: {{timeEntry.rejectionReason}}

View time entry at: {{timeEntry.url}}
      `
    }
  ];

  const systemTemplatesToInsert = systemTemplatesPayload.filter((template) => {
    if (template.notification_subtype_id) return true;
    console.warn(
      `[seed 68_add_notification_templates] Skipping system template '${template.name}' because notification_subtype_id is missing`
    );
    return false;
  });

  const systemTemplates = await knex('system_email_templates')
    .insert(systemTemplatesToInsert)
    .returning('*');

  const now = new Date();
  let surveysCategory = await knex('notification_categories').where({ name: SURVEY_CATEGORY_NAME }).first();
  if (!surveysCategory) {
    [surveysCategory] = await knex('notification_categories')
      .insert({
        name: SURVEY_CATEGORY_NAME,
        description: 'Customer satisfaction surveys and feedback loops',
        is_enabled: true,
        is_default_enabled: true,
        created_at: now,
        updated_at: now,
      })
      .returning('*');
  }

  let surveySubtype = await knex('notification_subtypes').where({ name: SURVEY_SUBTYPE_NAME }).first();
  if (!surveySubtype) {
    [surveySubtype] = await knex('notification_subtypes')
      .insert({
        category_id: surveysCategory.id,
        name: SURVEY_SUBTYPE_NAME,
        description: 'Customer satisfaction survey invitation when a ticket is closed',
        is_enabled: true,
        is_default_enabled: true,
        created_at: now,
        updated_at: now,
      })
      .returning('*');
  }

  for (const translation of SURVEY_TEMPLATE_TRANSLATIONS) {
    const payload = {
      name: SURVEY_TEMPLATE_NAME,
      language_code: translation.language,
      subject: translation.subject,
      html_content: buildSurveyHtmlTemplate(translation),
      text_content: buildSurveyTextTemplate(translation),
      notification_subtype_id: surveySubtype.id,
      updated_at: now,
      created_at: now,
    };

    const existingSurveyTemplate = await knex('system_email_templates')
      .where({ name: SURVEY_TEMPLATE_NAME, language_code: translation.language })
      .first();

    if (existingSurveyTemplate) {
      await knex('system_email_templates')
        .where({ id: existingSurveyTemplate.id })
        .update({ ...payload, created_at: existingSurveyTemplate.created_at });
    } else {
      await knex('system_email_templates').insert(payload);
    }
  }

  // No need to create tenant templates by default - users will customize them as needed
};
