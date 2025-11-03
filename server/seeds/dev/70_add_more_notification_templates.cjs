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
  
    // Get subtypes for reference - only the ones we're adding in this seed
    const subtypes = await knex('notification_subtypes')
      .select('id', 'name')
      .whereIn('name', [
        'Ticket Assigned',
        'Ticket Comment Added',
        'Project Assigned',
        'Project Task Assigned',
        'Project Updated',
        'Project Closed'
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
  
    // Only delete the templates we're about to replace/add in this seed
    // Don't touch templates from seed 68 or auth templates
    const templatesToReplace = [
      'ticket-assigned',
      'ticket-comment-added',
      'project-assigned',
      'project-task-assigned-primary',
      'project-task-assigned-additional',
      'project-updated',
      'project-closed'
    ];

    await knex('system_email_templates')
      .whereIn('name', templatesToReplace)
      .where('language_code', 'en')
      .del();
  
    // Insert system-wide default templates
    await knex('system_email_templates').insert([
      // Ticket templates
      {
        name: 'ticket-assigned',
        language_code: 'en',
        subject: 'Ticket Assigned • {{ticket.title}} ({{ticket.priority}})',
        notification_subtype_id: getSubtypeId('Ticket Assigned'),
        html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Assigned</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">You have been assigned to a ticket for <strong>{{ticket.clientName}}</strong>. Review the details below and take action.</p>
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Assigned By</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{ticket.assignedBy}}</td>
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
Ticket Assigned to You

{{ticket.metaLine}}
Assigned By: {{ticket.assignedBy}}

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
      name: 'ticket-comment-added',
      language_code: 'en',
      subject: 'New Comment • {{ticket.title}}',
      notification_subtype_id: getSubtypeId('Ticket Comment Added'),
      html_content: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4ddff;box-shadow:0 12px 32px rgba(138,77,234,0.12);">
            <tr>
              <td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">
                <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">New Comment Added</div>
                <div style="font-size:22px;font-weight:600;margin-top:8px;">{{ticket.title}}</div>
                <div style="margin-top:12px;font-size:14px;opacity:0.85;">{{ticket.metaLine}}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;">
                <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">A new comment has been added to a ticket for <strong>{{ticket.clientName}}</strong>.</p>
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
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;font-weight:600;color:#475467;">Comment By</td>
                    <td style="padding:12px 0;border-bottom:1px solid #eef2ff;">{{comment.author}}</td>
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
                <div style="margin:28px 0 16px 0;padding:18px 20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
                  <div style="font-weight:600;color:#1e40af;margin-bottom:8px;">💬 Comment</div>
                  <div style="color:#475467;line-height:1.5;">{{comment.content}}</div>
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
New Comment Added

{{ticket.metaLine}}
Comment By: {{comment.author}}

Priority: {{ticket.priority}}
Status: {{ticket.status}}
Assigned To: {{ticket.assignedDetails}}
Requester: {{ticket.requesterDetails}}
Board: {{ticket.board}}
Category: {{ticket.categoryDetails}}
Location: {{ticket.locationSummary}}

Comment:
{{comment.content}}

View ticket: {{ticket.url}}
      `
    },

      // Project templates
      {
        name: 'project-updated',
        language_code: 'en',
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
        language_code: 'en',
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
        language_code: 'en',
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
        language_code: 'en',
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
        language_code: 'en',
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
      }
    ]).returning('*');

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
          description: 'When a customer satisfaction survey invitation is sent after a ticket is closed',
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
