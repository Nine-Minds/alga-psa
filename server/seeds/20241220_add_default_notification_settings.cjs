/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // First, clean up existing data
  await knex('notification_logs').del();
  await knex('user_notification_preferences').del();
  await knex('notification_subtypes').del();
  await knex('notification_categories').del();
  await knex('tenant_email_templates').del();
  await knex('system_email_templates').del();
  await knex('notification_settings').del();

  // Insert default categories
  const categories = await knex('notification_categories').insert([
    {
      tenant: 'default',
      name: 'Tickets',
      description: 'Notifications related to support tickets',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      tenant: 'default',
      name: 'Invoices',
      description: 'Notifications related to billing and invoices',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      tenant: 'default',
      name: 'Projects',
      description: 'Notifications related to project updates',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      tenant: 'default',
      name: 'Time Entries',
      description: 'Notifications related to time tracking and approvals',
      is_enabled: true,
      is_default_enabled: true
    }
  ]).returning('*');

  // Map categories by name for easier reference
  const categoryMap = categories.reduce((acc, cat) => {
    acc[cat.name] = cat;
    return acc;
  }, {});

  // Insert subtypes
  await knex('notification_subtypes').insert([
    // Ticket notifications
    {
      category_id: categoryMap.Tickets.id,
      name: 'Ticket Created',
      description: 'When a new ticket is created',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Tickets.id,
      name: 'Ticket Updated',
      description: 'When a ticket is modified',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Tickets.id,
      name: 'Ticket Closed',
      description: 'When a ticket is closed',
      is_enabled: true,
      is_default_enabled: true
    },

    // Invoice notifications
    {
      category_id: categoryMap.Invoices.id,
      name: 'Invoice Generated',
      description: 'When a new invoice is generated',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Invoices.id,
      name: 'Payment Received',
      description: 'When a payment is received',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Invoices.id,
      name: 'Payment Overdue',
      description: 'When an invoice payment is overdue',
      is_enabled: true,
      is_default_enabled: true
    },

    // Project notifications
    {
      category_id: categoryMap.Projects.id,
      name: 'Project Created',
      description: 'When a new project is created',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Projects.id,
      name: 'Task Updated',
      description: 'When a project task is updated',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap.Projects.id,
      name: 'Milestone Completed',
      description: 'When a project milestone is completed',
      is_enabled: true,
      is_default_enabled: true
    },

    // Time Entry notifications
    {
      category_id: categoryMap['Time Entries'].id,
      name: 'Time Entry Submitted',
      description: 'When time entries are submitted for approval',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap['Time Entries'].id,
      name: 'Time Entry Approved',
      description: 'When time entries are approved',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: categoryMap['Time Entries'].id,
      name: 'Time Entry Rejected',
      description: 'When time entries are rejected',
      is_enabled: true,
      is_default_enabled: true
    }
  ]);

  // Base email template styles
  const baseStyles = `
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #007bff;
      color: white;
      padding: 20px;
      text-align: center;
      border-radius: 5px 5px 0 0;
    }
    .content {
      background-color: #ffffff;
      padding: 20px;
      border: 1px solid #e9ecef;
      border-radius: 0 0 5px 5px;
    }
    .footer {
      text-align: center;
      padding: 20px;
      color: #6c757d;
      font-size: 0.9em;
    }
    .button {
      display: inline-block;
      padding: 10px 20px;
      background-color: #007bff;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      margin: 20px 0;
    }
    .details {
      background-color: #f8f9fa;
      padding: 15px;
      border-radius: 5px;
      margin: 15px 0;
    }
  `;

  // Base HTML wrapper
  const wrapHtml = (title, content) => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>${baseStyles}</style>
    </head>
    <body>
      <div class="header">
        <h1>${title}</h1>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>This is an automated message from your PSA system.</p>
      </div>
    </body>
    </html>
  `;

  // Insert system-wide default templates
  const systemTemplates = await knex('system_email_templates').insert([
    {
      name: 'ticket-created',
      subject: 'New Ticket: {{ticket.title}}',
      html_content: wrapHtml('New Ticket', `
        <h2>New Ticket Created</h2>
        <p>A new ticket has been created in your PSA system:</p>
        <div class="details">
          <p><strong>Ticket ID:</strong> {{ticket.id}}</p>
          <p><strong>Title:</strong> {{ticket.title}}</p>
          <p><strong>Description:</strong> {{ticket.description}}</p>
          <p><strong>Priority:</strong> {{ticket.priority}}</p>
          <p><strong>Status:</strong> {{ticket.status}}</p>
        </div>
        {{#if ticket.url}}
        <a href="{{ticket.url}}" class="button">View Ticket</a>
        {{/if}}
        <p>Please review this ticket at your earliest convenience.</p>
      `),
      text_content: `
New Ticket Created

A new ticket has been created in your PSA system:

Ticket ID: {{ticket.id}}
Title: {{ticket.title}}
Description: {{ticket.description}}
Priority: {{ticket.priority}}
Status: {{ticket.status}}

{{#if ticket.url}}View ticket at: {{ticket.url}}{{/if}}

Please review this ticket at your earliest convenience.
      `,
      version: 1,
      is_active: true
    },
    {
      name: 'invoice-generated',
      subject: 'New Invoice #{{invoice.number}}',
      html_content: wrapHtml('New Invoice', `
        <h2>Invoice {{invoice.number}}</h2>
        <p>A new invoice has been generated for your review:</p>
        <div class="details">
          <p><strong>Invoice Number:</strong> {{invoice.number}}</p>
          <p><strong>Amount:</strong> ${{invoice.amount}}</p>
          <p><strong>Due Date:</strong> {{invoice.dueDate}}</p>
          <p><strong>Company:</strong> {{invoice.companyName}}</p>
        </div>
        {{#if invoice.url}}
        <a href="{{invoice.url}}" class="button">View Invoice</a>
        {{/if}}
        <p>Thank you for your business.</p>
      `),
      text_content: `
Invoice {{invoice.number}}

A new invoice has been generated for your review:

Invoice Number: {{invoice.number}}
Amount: ${{invoice.amount}}
Due Date: {{invoice.dueDate}}
Company: {{invoice.companyName}}

{{#if invoice.url}}View invoice at: {{invoice.url}}{{/if}}

Thank you for your business.
      `,
      version: 1,
      is_active: true
    },
    {
      name: 'project-update',
      subject: 'Project Update: {{project.name}}',
      html_content: wrapHtml('Project Update', `
        <h2>Project Update: {{project.name}}</h2>
        <div class="details">
          <p><strong>Status:</strong> {{project.status}}</p>
          <p><strong>Updated By:</strong> {{project.updatedBy}}</p>
          <p><strong>Progress:</strong> {{project.progress}}%</p>
        </div>
        <div style="margin: 20px 0;">
          <p>{{project.message}}</p>
        </div>
        {{#if project.url}}
        <a href="{{project.url}}" class="button">View Project</a>
        {{/if}}
      `),
      text_content: `
Project Update: {{project.name}}

Status: {{project.status}}
Updated By: {{project.updatedBy}}
Progress: {{project.progress}}%

{{project.message}}

{{#if project.url}}View project at: {{project.url}}{{/if}}
      `,
      version: 1,
      is_active: true
    }
  ]).returning('*');

  // Map system templates by name for easier reference
  const systemTemplateMap = systemTemplates.reduce((acc, template) => {
    acc[template.name] = template;
    return acc;
  }, {});

  // Insert tenant-specific templates that reference system templates
  await knex('tenant_email_templates').insert([
    {
      tenant: 'default',
      name: 'ticket-created',
      subject: 'New Ticket: {{ticket.title}}',
      html_content: `
        <h2>New Ticket Created</h2>
        <p>Ticket #{{ticket.id}} has been created.</p>
        <h3>Details:</h3>
        <ul>
          <li><strong>Title:</strong> {{ticket.title}}</li>
          <li><strong>Priority:</strong> {{ticket.priority}}</li>
          <li><strong>Description:</strong> {{ticket.description}}</li>
        </ul>
        <p><a href="{{ticket.url}}">View Ticket</a></p>
      `,
      text_content: `
New Ticket Created

Ticket #{{ticket.id}} has been created.

Details:
- Title: {{ticket.title}}
- Priority: {{ticket.priority}}
- Description: {{ticket.description}}

View ticket at: {{ticket.url}}
      `,
      version: 1,
      is_active: true,
      system_template_id: systemTemplateMap['ticket-created'].id
    },
    {
      tenant: 'default',
      name: 'invoice-generated',
      subject: 'New Invoice #{{invoice.number}}',
      html_content: `
        <h2>New Invoice Generated</h2>
        <p>Invoice #{{invoice.number}} has been generated for your review.</p>
        <h3>Summary:</h3>
        <ul>
          <li><strong>Amount:</strong> {{invoice.amount}}</li>
          <li><strong>Due Date:</strong> {{invoice.dueDate}}</li>
        </ul>
        <p><a href="{{invoice.url}}">View Invoice</a></p>
      `,
      text_content: `
New Invoice Generated

Invoice #{{invoice.number}} has been generated for your review.

Summary:
- Amount: {{invoice.amount}}
- Due Date: {{invoice.dueDate}}

View invoice at: {{invoice.url}}
      `,
      version: 1,
      is_active: true,
      system_template_id: systemTemplateMap['invoice-generated'].id
    },
    {
      tenant: 'default',
      name: 'project-update',
      subject: 'Project Update: {{project.name}}',
      html_content: `
        <h2>Project Update</h2>
        <p>There has been an update to project {{project.name}}.</p>
        <h3>Update Details:</h3>
        <ul>
          <li><strong>Status:</strong> {{project.status}}</li>
          <li><strong>Progress:</strong> {{project.progress}}%</li>
          <li><strong>Update:</strong> {{update.description}}</li>
        </ul>
        <p><a href="{{project.url}}">View Project</a></p>
      `,
      text_content: `
Project Update

There has been an update to project {{project.name}}.

Update Details:
- Status: {{project.status}}
- Progress: {{project.progress}}%
- Update: {{update.description}}

View project at: {{project.url}}
      `,
      version: 1,
      is_active: true,
      system_template_id: systemTemplateMap['project-update'].id
    }
  ]);

  // Insert default notification settings
  await knex('notification_settings').insert({
    tenant: 'default',
    is_enabled: true,
    rate_limit_per_minute: 60
  });
};
