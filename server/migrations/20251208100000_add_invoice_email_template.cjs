/**
 * Migration: Add Invoice Email subtype and template
 * This adds a new notification subtype and email template for sending invoices to clients
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Get the Invoices category
  const invoicesCategory = await knex('notification_categories')
    .where({ name: 'Invoices' })
    .first();

  if (!invoicesCategory) {
    console.warn('Invoices category not found, skipping invoice-email template creation');
    return;
  }

  // Check if the subtype already exists
  const existingSubtype = await knex('notification_subtypes')
    .where({ category_id: invoicesCategory.id, name: 'Invoice Email' })
    .first();

  let subtypeId;
  if (existingSubtype) {
    subtypeId = existingSubtype.id;
  } else {
    // Insert the new subtype
    const [newSubtype] = await knex('notification_subtypes')
      .insert({
        category_id: invoicesCategory.id,
        name: 'Invoice Email',
        description: 'Email sent to client with invoice attached',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
    subtypeId = newSubtype.id;
  }

  // Define the HTML template (matching the existing ticket-created style)
  const htmlTemplate = `
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
  `.trim();

  const textTemplate = `
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
  `.trim();

  // Check if template already exists
  const existingTemplate = await knex('system_email_templates')
    .where({ name: 'invoice-email', language_code: 'en' })
    .first();

  if (!existingTemplate) {
    // Insert the English template
    await knex('system_email_templates').insert({
      name: 'invoice-email',
      language_code: 'en',
      subject: 'Invoice {{invoice.number}} from {{company.name}}',
      html_content: htmlTemplate,
      text_content: textTemplate,
      notification_subtype_id: subtypeId
    });
  }

  console.log('✓ Invoice Email subtype and template added');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Delete the template first (due to foreign key)
  await knex('system_email_templates')
    .where({ name: 'invoice-email' })
    .del();

  // Delete the subtype
  await knex('notification_subtypes')
    .where({ name: 'Invoice Email' })
    .del();

  console.log('✓ Invoice Email subtype and template removed');
};
