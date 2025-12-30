/**
 * Migration: Add project task assigned email templates with modern styling
 *
 * Adds missing email templates for PROJECT_TASK_ASSIGNED events that were
 * previously only available in dev seeds. Uses modern styling consistent
 * with appointment and ticket notification templates.
 *
 * Templates: project-task-assigned-primary, project-task-assigned-additional
 * Language: en (English only - project emails are for internal MSP users)
 */
// Template content
const templates = {
  primary: {
    subject: 'You have been assigned to task: {{task.name}}',
    header: 'Task Assignment',
    greeting: 'Hello{{#if recipientName}} {{recipientName}}{{/if}}, you have been assigned as the primary resource for a project task.',
    assignedBadge: 'Primary Assignee',
    taskLabel: 'Task',
    projectLabel: 'Project',
    dueDateLabel: 'Due Date',
    assignedByLabel: 'Assigned By',
    roleLabel: 'Role',
    descriptionTitle: 'Description',
    viewButton: 'View Task'
  },
  additional: {
    subject: 'You have been added as additional resource to task: {{task.name}}',
    header: 'Task Assignment',
    greeting: 'Hello{{#if recipientName}} {{recipientName}}{{/if}}, you have been added as an additional resource for a project task.',
    assignedBadge: 'Additional Resource',
    taskLabel: 'Task',
    projectLabel: 'Project',
    dueDateLabel: 'Due Date',
    assignedByLabel: 'Assigned By',
    roleLabel: 'Role',
    descriptionTitle: 'Description',
    viewButton: 'View Task'
  }
};

// Generate HTML for project task assigned (primary or additional)
function generateTaskAssignedHtml(t, isPrimary) {
  const badgeColor = isPrimary ? 'rgba(16,185,129,0.12)' : 'rgba(138,77,234,0.12)';
  const badgeTextColor = isPrimary ? '#047857' : '#5b38b0';
  const headerGradient = isPrimary ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#8A4DEA,#40CFF9)';
  const buttonColor = isPrimary ? '#10b981' : '#8A4DEA';
  const footerBg = isPrimary ? '#f0fdf4' : '#f8f5ff';
  const footerColor = isPrimary ? '#047857' : '#5b38b0';

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
        <tr>
          <td style="padding:32px;background:${headerGradient};color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">${t.header}</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">{{task.name}}</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{task.project}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">${t.greeting}</p>
            <div style="margin-bottom:24px;">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:${badgeColor};color:${badgeTextColor};font-size:12px;font-weight:600;letter-spacing:0.02em;">${t.assignedBadge}</div>
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;width:160px;font-weight:600;color:#475467;">${t.taskLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.name}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.projectLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.project}}</td>
              </tr>
              {{#if task.dueDate}}
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.dueDateLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.dueDate}}</td>
              </tr>
              {{/if}}
              {{#if task.assignedBy}}
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">${t.assignedByLabel}</td>
                <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{task.assignedBy}}</td>
              </tr>
              {{/if}}
              {{#if task.role}}
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#475467;">${t.roleLabel}</td>
                <td style="padding:12px 0;">{{task.role}}</td>
              </tr>
              {{/if}}
            </table>
            {{#if task.description}}
            <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#f8f5ff;border:1px solid #e6deff;">
              <div style="font-weight:600;color:#5b38b0;margin-bottom:8px;">${t.descriptionTitle}</div>
              <div style="color:#475467;line-height:1.5;">{{task.description}}</div>
            </div>
            {{/if}}
            <a href="{{task.url}}" style="display:inline-block;background:${buttonColor};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">${t.viewButton}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:${footerBg};color:${footerColor};font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

// Generate text for project task assigned
function generateTaskAssignedText(t) {
  return `${t.header}

${t.greeting}

${t.assignedBadge}

${t.taskLabel}: {{task.name}}
${t.projectLabel}: {{task.project}}
{{#if task.dueDate}}${t.dueDateLabel}: {{task.dueDate}}{{/if}}
{{#if task.assignedBy}}${t.assignedByLabel}: {{task.assignedBy}}{{/if}}
{{#if task.role}}${t.roleLabel}: {{task.role}}{{/if}}

{{#if task.description}}${t.descriptionTitle}:
{{task.description}}{{/if}}

${t.viewButton}: {{task.url}}`;
}

exports.up = async function (knex) {
  console.log('Adding project task assigned email templates with modern styling...');

  // Ensure Projects category exists
  let projectsCategory = await knex('notification_categories').where({ name: 'Projects' }).first();

  if (!projectsCategory) {
    [projectsCategory] = await knex('notification_categories')
      .insert({
        name: 'Projects',
        description: 'Project-related notifications',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
    console.log('  Created Projects notification category');
  }

  // Create or get the notification subtype for project task assigned
  let taskAssignedSubtype = await knex('notification_subtypes').where({ name: 'Project Task Assigned' }).first();

  if (!taskAssignedSubtype) {
    [taskAssignedSubtype] = await knex('notification_subtypes')
      .insert({
        category_id: projectsCategory.id,
        name: 'Project Task Assigned',
        description: 'Notification when a user is assigned to a project task',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
    console.log('  Created notification subtype: Project Task Assigned');
  }

  // Upsert project-task-assigned-primary (English only)
  const primary = await knex('system_email_templates').where({ name: 'project-task-assigned-primary', language_code: 'en' }).first();

  if (primary) {
    await knex('system_email_templates')
      .where({ id: primary.id })
      .update({
        subject: templates.primary.subject,
        html_content: generateTaskAssignedHtml(templates.primary, true),
        text_content: generateTaskAssignedText(templates.primary),
        notification_subtype_id: taskAssignedSubtype.id,
        updated_at: new Date()
      });
    console.log('  Updated: project-task-assigned-primary (en)');
  } else {
    await knex('system_email_templates').insert({
      name: 'project-task-assigned-primary',
      language_code: 'en',
      subject: templates.primary.subject,
      html_content: generateTaskAssignedHtml(templates.primary, true),
      text_content: generateTaskAssignedText(templates.primary),
      notification_subtype_id: taskAssignedSubtype.id,
      created_at: new Date(),
      updated_at: new Date()
    });
    console.log('  Created: project-task-assigned-primary (en)');
  }

  // Upsert project-task-assigned-additional (English only)
  const additional = await knex('system_email_templates').where({ name: 'project-task-assigned-additional', language_code: 'en' }).first();

  if (additional) {
    await knex('system_email_templates')
      .where({ id: additional.id })
      .update({
        subject: templates.additional.subject,
        html_content: generateTaskAssignedHtml(templates.additional, false),
        text_content: generateTaskAssignedText(templates.additional),
        notification_subtype_id: taskAssignedSubtype.id,
        updated_at: new Date()
      });
    console.log('  Updated: project-task-assigned-additional (en)');
  } else {
    await knex('system_email_templates').insert({
      name: 'project-task-assigned-additional',
      language_code: 'en',
      subject: templates.additional.subject,
      html_content: generateTaskAssignedHtml(templates.additional, false),
      text_content: generateTaskAssignedText(templates.additional),
      notification_subtype_id: taskAssignedSubtype.id,
      created_at: new Date(),
      updated_at: new Date()
    });
    console.log('  Created: project-task-assigned-additional (en)');
  }

  console.log('Successfully added project task assigned email templates');
};

exports.down = async function (knex) {
  console.log('Removing project task assigned email templates...');

  await knex('system_email_templates').whereIn('name', ['project-task-assigned-primary', 'project-task-assigned-additional']).delete();

  console.log('Removed project task assigned email templates');
};

