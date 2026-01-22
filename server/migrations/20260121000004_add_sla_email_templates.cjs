/**
 * Migration: Add SLA Email notification category, subtypes, and templates
 *
 * Creates email notification infrastructure for SLA alerts:
 * - SLA category in notification_categories
 * - Subtypes: SLA Warning, SLA Breach, SLA Escalation
 * - English email templates with HTML and text versions
 *
 * Note: SLA email notifications are internal-only (assignee, board manager, escalation manager),
 * so multi-language translations are not required.
 */

exports.up = async function(knex) {
  console.log('Adding SLA email notification category, subtypes, and templates...');

  // 1. Check if SLA category exists, create if not
  let slaCategory = await knex('notification_categories')
    .where({ name: 'SLA' })
    .first();

  if (!slaCategory) {
    [slaCategory] = await knex('notification_categories')
      .insert({
        name: 'SLA',
        description: 'SLA-related email notifications'
      })
      .returning('*');
  }

  // 2. Create subtypes
  const subtypeData = [
    {
      category_id: slaCategory.id,
      name: 'SLA Warning',
      description: 'SLA threshold warning email (approaching breach)',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: slaCategory.id,
      name: 'SLA Breach',
      description: 'SLA breach notification email',
      is_enabled: true,
      is_default_enabled: true
    },
    {
      category_id: slaCategory.id,
      name: 'SLA Escalation',
      description: 'Ticket escalation due to SLA',
      is_enabled: true,
      is_default_enabled: true
    }
  ];

  const subtypes = {};
  for (const subtype of subtypeData) {
    let existing = await knex('notification_subtypes')
      .where({ category_id: subtype.category_id, name: subtype.name })
      .first();

    if (!existing) {
      [existing] = await knex('notification_subtypes')
        .insert(subtype)
        .returning('*');
    }
    subtypes[subtype.name] = existing.id;
  }

  // 3. Define email templates

  // SLA Warning Template
  const slaWarningHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #fde68a;box-shadow:0 12px 32px rgba(245,158,11,0.12);">
        <tr>
          <td style="padding:32px;background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">SLA Warning</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">{{thresholdPercent}}% Time Elapsed</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">Ticket #{{ticketNumber}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Hi {{recipientName}},</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">A ticket you are responsible for is approaching its SLA deadline.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fef3c7;width:160px;font-weight:600;color:#92400e;">Ticket</td>
                <td style="padding:12px 0;border-bottom:1px solid #fef3c7;">
                  <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(245,158,11,0.12);color:#92400e;font-size:12px;font-weight:600;letter-spacing:0.02em;">#{{ticketNumber}}</span>
                  {{ticketTitle}}
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fef3c7;font-weight:600;color:#92400e;">SLA Type</td>
                <td style="padding:12px 0;border-bottom:1px solid #fef3c7;">{{slaType}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fef3c7;font-weight:600;color:#92400e;">Time Remaining</td>
                <td style="padding:12px 0;border-bottom:1px solid #fef3c7;">
                  <span style="font-size:16px;font-weight:700;color:#d97706;">{{timeRemaining}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fef3c7;font-weight:600;color:#92400e;">Priority</td>
                <td style="padding:12px 0;border-bottom:1px solid #fef3c7;">{{priority}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#92400e;">Client</td>
                <td style="padding:12px 0;">{{clientName}}</td>
              </tr>
            </table>

            <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Please take action to avoid an SLA breach.</p>

            {{#if ticketUrl}}
            <div style="text-align:center;margin:24px 0;">
              <a href="{{ticketUrl}}" style="display:inline-block;padding:14px 32px;border-radius:8px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">View Ticket</a>
            </div>
            {{/if}}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#fef3c7;color:#92400e;font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
  `.trim();

  const slaWarningText = `
SLA WARNING: {{thresholdPercent}}% Time Elapsed

Hi {{recipientName}},

A ticket you are responsible for is approaching its SLA deadline.

Ticket Details:
- Ticket: #{{ticketNumber}} - {{ticketTitle}}
- SLA Type: {{slaType}}
- Time Remaining: {{timeRemaining}}
- Priority: {{priority}}
- Client: {{clientName}}

Please take action to avoid an SLA breach.

{{#if ticketUrl}}
View Ticket: {{ticketUrl}}
{{/if}}

---
Powered by Alga PSA
  `.trim();

  // SLA Breach Template
  const slaBreachHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #fecaca;box-shadow:0 12px 32px rgba(239,68,68,0.12);">
        <tr>
          <td style="padding:32px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">SLA Breach</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">{{slaType}} SLA Exceeded</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">Ticket #{{ticketNumber}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Hi {{recipientName}},</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#dc2626;line-height:1.5;font-weight:600;">A ticket has breached its SLA target and requires immediate attention.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;width:160px;font-weight:600;color:#991b1b;">Ticket</td>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;">
                  <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(239,68,68,0.12);color:#991b1b;font-size:12px;font-weight:600;letter-spacing:0.02em;">#{{ticketNumber}}</span>
                  {{ticketTitle}}
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;font-weight:600;color:#991b1b;">SLA Type</td>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;">{{slaType}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;font-weight:600;color:#991b1b;">Time Overdue</td>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;">
                  <span style="font-size:16px;font-weight:700;color:#dc2626;">{{timeOverdue}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;font-weight:600;color:#991b1b;">Priority</td>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;">{{priority}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;font-weight:600;color:#991b1b;">Client</td>
                <td style="padding:12px 0;border-bottom:1px solid #fee2e2;">{{clientName}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#991b1b;">SLA Policy</td>
                <td style="padding:12px 0;">{{policyName}}</td>
              </tr>
            </table>

            <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Please address this ticket immediately.</p>

            {{#if ticketUrl}}
            <div style="text-align:center;margin:24px 0;">
              <a href="{{ticketUrl}}" style="display:inline-block;padding:14px 32px;border-radius:8px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">View Ticket Now</a>
            </div>
            {{/if}}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#fee2e2;color:#991b1b;font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
  `.trim();

  const slaBreachText = `
SLA BREACH: {{slaType}} SLA Exceeded

Hi {{recipientName}},

A ticket has breached its SLA target and requires immediate attention.

Ticket Details:
- Ticket: #{{ticketNumber}} - {{ticketTitle}}
- SLA Type: {{slaType}}
- Time Overdue: {{timeOverdue}}
- Priority: {{priority}}
- Client: {{clientName}}
- SLA Policy: {{policyName}}

Please address this ticket immediately.

{{#if ticketUrl}}
View Ticket: {{ticketUrl}}
{{/if}}

---
Powered by Alga PSA
  `.trim();

  // SLA Escalation Template
  const slaEscalationHtml = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf5ff;padding:32px 0;font-family:'Segoe UI',Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e9d5ff;box-shadow:0 12px 32px rgba(147,51,234,0.12);">
        <tr>
          <td style="padding:32px;background:linear-gradient(135deg,#9333ea,#7c3aed);color:#ffffff;">
            <div style="text-transform:uppercase;letter-spacing:0.08em;font-size:12px;font-weight:600;opacity:0.85;">Ticket Escalation</div>
            <div style="font-size:22px;font-weight:600;margin-top:8px;">Level {{escalationLevel}} Escalation</div>
            <div style="margin-top:12px;font-size:14px;opacity:0.85;">Ticket #{{ticketNumber}}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 20px 32px;">
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Hi {{recipientName}},</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">A ticket has been escalated to you due to SLA concerns. You have been added as an escalation manager.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1f2933;margin:24px 0;">
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;width:160px;font-weight:600;color:#6b21a8;">Ticket</td>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;">
                  <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(147,51,234,0.12);color:#6b21a8;font-size:12px;font-weight:600;letter-spacing:0.02em;">#{{ticketNumber}}</span>
                  {{ticketTitle}}
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;font-weight:600;color:#6b21a8;">Escalation Level</td>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;">
                  <span style="font-size:16px;font-weight:700;color:#9333ea;">Level {{escalationLevel}}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;font-weight:600;color:#6b21a8;">Reason</td>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;">{{escalationReason}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;font-weight:600;color:#6b21a8;">Priority</td>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;">{{priority}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;font-weight:600;color:#6b21a8;">Client</td>
                <td style="padding:12px 0;border-bottom:1px solid #f3e8ff;">{{clientName}}</td>
              </tr>
              <tr>
                <td style="padding:12px 0;font-weight:600;color:#6b21a8;">Assigned To</td>
                <td style="padding:12px 0;">{{assigneeName}}</td>
              </tr>
            </table>

            <p style="margin:24px 0 16px 0;font-size:15px;color:#1f2933;line-height:1.5;">Please review this ticket and take appropriate action.</p>

            {{#if ticketUrl}}
            <div style="text-align:center;margin:24px 0;">
              <a href="{{ticketUrl}}" style="display:inline-block;padding:14px 32px;border-radius:8px;background:linear-gradient(135deg,#9333ea,#7c3aed);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">View Ticket</a>
            </div>
            {{/if}}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background:#f3e8ff;color:#6b21a8;font-size:12px;text-align:center;">Powered by Alga PSA</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
  `.trim();

  const slaEscalationText = `
TICKET ESCALATION: Level {{escalationLevel}}

Hi {{recipientName}},

A ticket has been escalated to you due to SLA concerns. You have been added as an escalation manager.

Ticket Details:
- Ticket: #{{ticketNumber}} - {{ticketTitle}}
- Escalation Level: Level {{escalationLevel}}
- Reason: {{escalationReason}}
- Priority: {{priority}}
- Client: {{clientName}}
- Assigned To: {{assigneeName}}

Please review this ticket and take appropriate action.

{{#if ticketUrl}}
View Ticket: {{ticketUrl}}
{{/if}}

---
Powered by Alga PSA
  `.trim();

  // 4. Insert templates
  const templates = [
    {
      name: 'sla-warning',
      language_code: 'en',
      subject: 'SLA Warning: Ticket #{{ticketNumber}} at {{thresholdPercent}}%',
      html_content: slaWarningHtml,
      text_content: slaWarningText,
      notification_subtype_id: subtypes['SLA Warning']
    },
    {
      name: 'sla-breach',
      language_code: 'en',
      subject: 'SLA BREACH: Ticket #{{ticketNumber}} - {{slaType}} SLA Exceeded',
      html_content: slaBreachHtml,
      text_content: slaBreachText,
      notification_subtype_id: subtypes['SLA Breach']
    },
    {
      name: 'sla-escalation',
      language_code: 'en',
      subject: 'Ticket Escalated: #{{ticketNumber}} - Level {{escalationLevel}}',
      html_content: slaEscalationHtml,
      text_content: slaEscalationText,
      notification_subtype_id: subtypes['SLA Escalation']
    }
  ];

  for (const template of templates) {
    const existing = await knex('system_email_templates')
      .where({ name: template.name, language_code: template.language_code })
      .first();

    if (!existing) {
      await knex('system_email_templates').insert(template);
    }
  }

  console.log('Successfully added SLA email notification templates');
};

exports.down = async function(knex) {
  console.log('Removing SLA email notification templates...');

  // Delete templates
  await knex('system_email_templates')
    .whereIn('name', ['sla-warning', 'sla-breach', 'sla-escalation'])
    .delete();

  // Delete subtypes
  await knex('notification_subtypes')
    .whereIn('name', ['SLA Warning', 'SLA Breach', 'SLA Escalation'])
    .delete();

  // Delete category if empty
  const slaCategory = await knex('notification_categories')
    .where({ name: 'SLA' })
    .first();

  if (slaCategory) {
    const remainingSubtypes = await knex('notification_subtypes')
      .where({ category_id: slaCategory.id })
      .count('* as count')
      .first();

    if (Number(remainingSubtypes?.count || 0) === 0) {
      await knex('notification_categories')
        .where({ name: 'SLA' })
        .delete();
    }
  }

  console.log('Successfully removed SLA email notification templates');
};
