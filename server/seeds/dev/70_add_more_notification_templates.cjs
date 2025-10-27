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
  
    // Get subtypes for reference
    const subtypes = await knex('notification_subtypes')
      .select('id', 'name')
      .whereIn('name', [
        'Ticket Assigned',
        'Ticket Created',
        'Ticket Updated',
        'Ticket Closed',
        'Ticket Comment Added',
        'Invoice Generated',
        'Payment Received',
        'Payment Overdue',
        'Project Assigned',
        'Project Task Assigned',
        'Project Created',
        'Project Updated',
        'Project Closed',
        'Task Updated',
        'Milestone Completed',
        'Time Entry Submitted',
        'Time Entry Approved',
        'Time Entry Rejected'
      ]);
  
    if (subtypes.length === 0) {
      throw new Error('No notification subtypes found. Make sure 20241220_add_default_notification_settings has been run.');
    }
  
    // Debug logging
    console.log('Found notification subtypes:', subtypes.map(s => ({ id: s.id, name: s.name })));
  
    // Helper function to safely get subtype ID
    const getSubtypeId = (name) => {
      const subtype = subtypes.find(s => s.name === name);
      if (!subtype) {
        console.error(`Could not find notification subtype: ${name}`);
        throw new Error(`Missing notification subtype: ${name}`);
      }
      return subtype.id;
    };
  
    // Clean up any existing notification templates (but keep authentication templates)
    await knex('tenant_email_templates').del();

    // Delete only notification-related system templates, preserve authentication templates
    const authTemplateNames = ['email-verification', 'password-reset', 'portal-invitation', 'tenant-recovery', 'no-account-found'];
    await knex('system_email_templates')
      .whereNotIn('name', authTemplateNames)
      .del();
  
    // Insert system-wide default templates
    const systemTemplates = await knex('system_email_templates').insert([
      // Ticket templates
      {
        name: 'ticket-assigned',
        subject: 'You have been assigned to ticket: {{ticket.title}}',
        notification_subtype_id: getSubtypeId('Ticket Assigned'),
        html_content: `
          <h2>Ticket Assigned</h2>
          <p>You have been assigned to a ticket:</p>
          <div class="details">
            <p><strong>Ticket ID:</strong> {{ticket.id}}</p>
            <p><strong>Title:</strong> {{ticket.title}}</p>
            <p><strong>Priority:</strong> {{ticket.priority}}</p>
            <p><strong>Status:</strong> {{ticket.status}}</p>
            <p><strong>Assigned By:</strong> {{ticket.assignedBy}}</p>
          </div>
          <a href="{{ticket.url}}" class="button">View Ticket</a>
        `,
        text_content: `
  Ticket Assigned
  
  You have been assigned to a ticket:
  
  Ticket ID: {{ticket.id}}
  Title: {{ticket.title}}
  Priority: {{ticket.priority}}
  Status: {{ticket.status}}
  Assigned By: {{ticket.assignedBy}}
  
  View ticket at: {{ticket.url}}
        `
      },
      {
        name: 'ticket-created',
        subject: 'New Ticket: {{ticket.title}}',
        notification_subtype_id: getSubtypeId('Ticket Created'),
        html_content: `
          <h2>New Ticket Created</h2>
          <p>A new ticket has been created in your PSA system:</p>
          <div class="details">
            <p><strong>Ticket ID:</strong> {{ticket.id}}</p>
            <p><strong>Title:</strong> {{ticket.title}}</p>
            <p><strong>Description:</strong> {{ticket.description}}</p>
            <p><strong>Priority:</strong> {{ticket.priority}}</p>
            <p><strong>Status:</strong> {{ticket.status}}</p>
          </div>
          <a href="{{ticket.url}}" class="button">View Ticket</a>
        `,
        text_content: `
  New Ticket Created
  
  A new ticket has been created in your PSA system:
  
  Ticket ID: {{ticket.id}}
  Title: {{ticket.title}}
  Description: {{ticket.description}}
  Priority: {{ticket.priority}}
  Status: {{ticket.status}}
  
  View ticket at: {{ticket.url}}
        `
      },
      {
        name: 'ticket-updated',
        subject: 'Ticket Updated: {{ticket.title}}',
        notification_subtype_id: getSubtypeId('Ticket Updated'),
        html_content: `
          <h2>Ticket Updated</h2>
          <p>A ticket has been updated in your PSA system:</p>
          <div class="details">
            <p><strong>Ticket ID:</strong> {{ticket.id}}</p>
            <p><strong>Title:</strong> {{ticket.title}}</p>
            <p><strong>Changes:</strong> {{ticket.changes}}</p>
            <p><strong>Updated By:</strong> {{ticket.updatedBy}}</p>
          </div>
          <a href="{{ticket.url}}" class="button">View Ticket</a>
        `,
        text_content: `
  Ticket Updated
  
  A ticket has been updated in your PSA system:
  
  Ticket ID: {{ticket.id}}
  Title: {{ticket.title}}
  Changes: {{ticket.changes}}
  Updated By: {{ticket.updatedBy}}
  
  View ticket at: {{ticket.url}}
        `
      },
      {
        name: 'ticket-closed',
        subject: 'Ticket Closed: {{ticket.title}}',
        notification_subtype_id: getSubtypeId('Ticket Closed'),
        html_content: `
          <h2>Ticket Closed</h2>
          <p>A ticket has been closed in your PSA system:</p>
          <div class="details">
            <p><strong>Ticket ID:</strong> {{ticket.id}}</p>
            <p><strong>Title:</strong> {{ticket.title}}</p>
            <p><strong>Resolution:</strong> {{ticket.resolution}}</p>
            <p><strong>Closed By:</strong> {{ticket.closedBy}}</p>
          </div>
          <a href="{{ticket.url}}" class="button">View Ticket</a>
        `,
        text_content: `
  Ticket Closed
  
  A ticket has been closed in your PSA system:
  
  Ticket ID: {{ticket.id}}
  Title: {{ticket.title}}
  Resolution: {{ticket.resolution}}
  Closed By: {{ticket.closedBy}}
  
  View ticket at: {{ticket.url}}
        `
      },
    {
      name: 'ticket-comment-added',
      subject: 'New Comment on Ticket: {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
        <h2>New Comment Added</h2>
        <p>A new comment has been added to ticket:</p>
        <div class="details">
          <p><strong>Ticket ID:</strong> {{ticket.id}}</p>
          <p><strong>Title:</strong> {{ticket.title}}</p>
          <p><strong>Comment By:</strong> {{comment.author}}</p>
          <p><strong>Comment:</strong></p>
          <div class="comment-content">
            {{comment.content}}
          </div>
        </div>
        <a href="{{ticket.url}}" class="button">View Ticket</a>
      `,
      text_content: `
  New Comment Added
  
  A new comment has been added to ticket:
  
  Ticket ID: {{ticket.id}}
  Title: {{ticket.title}}
  Comment By: {{comment.author}}
  
  Comment:
  {{comment.content}}
  
  View ticket at: {{ticket.url}}
      `
    },
      // Invoice templates
      {
        name: 'invoice-generated',
        subject: 'New Invoice #{{invoice.number}}',
        notification_subtype_id: getSubtypeId('Invoice Generated'),
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
        subject: 'Payment Received: Invoice #{{invoice.number}}',
        notification_subtype_id: getSubtypeId('Payment Received'),
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
        subject: 'Payment Overdue: Invoice #{{invoice.number}}',
        notification_subtype_id: getSubtypeId('Payment Overdue'),
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
  
      // Project templates
      {
        name: 'project-updated',
        subject: 'Project Updated: {{project.name}}',
        notification_subtype_id: getSubtypeId('Project Updated'),
        html_content: `
          <h2>Project Updated</h2>
          <p>A project has been updated:</p>
          <div class="details">
            <p><strong>Project Name:</strong> {{project.name}}</p>
            <p><strong>Status:</strong> {{project.status}}</p>
            <p><strong>Changes:</strong></p>
            <pre>{{project.changes}}</pre>
            <p><strong>Updated By:</strong> {{project.updatedBy}}</p>
          </div>
          <a href="{{project.url}}" class="button">View Project</a>
        `,
        text_content: `
  Project Updated
  
  A project has been updated:
  
  Project Name: {{project.name}}
  Status: {{project.status}}
  Changes:
  {{project.changes}}
  Updated By: {{project.updatedBy}}
  
  View project at: {{project.url}}
        `
      },
      {
        name: 'project-closed',
        subject: 'Project Closed: {{project.name}}',
        notification_subtype_id: getSubtypeId('Project Closed'),
        html_content: `
          <h2>Project Closed</h2>
          <p>A project has been closed:</p>
          <div class="details">
            <p><strong>Project Name:</strong> {{project.name}}</p>
            <p><strong>Status:</strong> {{project.status}}</p>
            <p><strong>Changes:</strong></p>
            <pre>{{project.changes}}</pre>
            <p><strong>Closed By:</strong> {{project.closedBy}}</p>
          </div>
          <a href="{{project.url}}" class="button">View Project</a>
        `,
        text_content: `
  Project Closed
  
  A project has been closed:
  
  Project Name: {{project.name}}
  Status: {{project.status}}
  Changes:
  {{project.changes}}
  Closed By: {{project.closedBy}}
  
  View project at: {{project.url}}
        `
      },
      {
        name: 'project-assigned',
        subject: 'You have been assigned to project: {{project.name}}',
        notification_subtype_id: getSubtypeId('Project Assigned'),
        html_content: `
          <h2>Project Assigned</h2>
          <p>You have been assigned to a project:</p>
          <div class="details">
            <p><strong>Project Name:</strong> {{project.name}}</p>
            <p><strong>Description:</strong> {{project.description}}</p>
            <p><strong>Start Date:</strong> {{project.startDate}}</p>
            <p><strong>Assigned By:</strong> {{project.assignedBy}}</p>
          </div>
          <a href="{{project.url}}" class="button">View Project</a>
        `,
        text_content: `
  Project Assigned
  
  You have been assigned to a project:
  
  Project Name: {{project.name}}
  Description: {{project.description}}
  Start Date: {{project.startDate}}
  Assigned By: {{project.assignedBy}}
  
  View project at: {{project.url}}
        `
      },
      {
        name: 'project-task-assigned-primary',
        subject: 'You have been assigned to task: {{task.name}}',
        notification_subtype_id: getSubtypeId('Project Task Assigned'),
        html_content: `
          <h2>Task Assignment</h2>
          <p>You have been assigned as the <strong>Primary Assignee</strong> for this task:</p>
          <div class="details">
            <p><strong>Task Name:</strong> {{task.name}}</p>
            <p><strong>Project:</strong> {{task.project}}</p>
            <p><strong>Due Date:</strong> {{task.dueDate}}</p>
            <p><strong>Assigned By:</strong> {{task.assignedBy}}</p>
            <p><strong>Role:</strong> {{task.role}}</p>
          </div>
          <a href="{{task.url}}" class="button">View Task</a>
        `,
        text_content: `
  Task Assignment
  
  You have been assigned as the Primary Assignee for this task:
  
  Task Name: {{task.name}}
  Project: {{task.project}}
  Due Date: {{task.dueDate}}
  Assigned By: {{task.assignedBy}}
  Role: {{task.role}}
  
  View task at: {{task.url}}
        `
      },
      {
        name: 'project-task-assigned-additional',
        subject: 'You have been added as additional agent to task: {{task.name}}',
        notification_subtype_id: getSubtypeId('Project Task Assigned'),
        html_content: `
          <h2>Task Assignment</h2>
          <p>You have been added as an <strong>Additional Agent</strong> to this task:</p>
          <div class="details">
            <p><strong>Task Name:</strong> {{task.name}}</p>
            <p><strong>Project:</strong> {{task.project}}</p>
            <p><strong>Due Date:</strong> {{task.dueDate}}</p>
            <p><strong>Assigned By:</strong> {{task.assignedBy}}</p>
            <p><strong>Role:</strong> {{task.role}}</p>
          </div>
          <a href="{{task.url}}" class="button">View Task</a>
        `,
        text_content: `
  Task Assignment
  
  You have been added as an Additional Agent to this task:
  
  Task Name: {{task.name}}
  Project: {{task.project}}
  Due Date: {{task.dueDate}}
  Assigned By: {{task.assignedBy}}
  Role: {{task.role}}
  
  View task at: {{task.url}}
        `
      },
      {
        name: 'project-created',
        subject: 'New Project Created: {{project.name}}',
        notification_subtype_id: getSubtypeId('Project Created'),
        html_content: `
          <h2>New Project Created</h2>
          <p>A new project has been created:</p>
          <div class="details">
            <p><strong>Project Name:</strong> {{project.name}}</p>
            <p><strong>Client:</strong> {{project.client}}</p>
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
  Client: {{project.client}}
  Description: {{project.description}}
  Start Date: {{project.startDate}}
  Project Manager: {{project.manager}}
  
  View project at: {{project.url}}
        `
      },
      {
        name: 'task-updated',
        subject: 'Task Updated: {{task.name}}',
        notification_subtype_id: getSubtypeId('Task Updated'),
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
        subject: 'Milestone Completed: {{milestone.name}}',
        notification_subtype_id: getSubtypeId('Milestone Completed'),
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
        subject: 'Time Entry Submitted for Review',
        notification_subtype_id: getSubtypeId('Time Entry Submitted'),
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
        subject: 'Time Entry Approved',
        notification_subtype_id: getSubtypeId('Time Entry Approved'),
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
        subject: 'Time Entry Rejected',
        notification_subtype_id: getSubtypeId('Time Entry Rejected'),
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
    ]).returning('*');
  
    // No need to create tenant templates by default - users will customize them as needed
  };
