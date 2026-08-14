/**
 * Migration to add Hour Block Expiring notification subtype and email template.
 * Mirrors 20250226090000_add_credit_expiration_notification.cjs. Uses the
 * existing Invoices category.
 *
 * Note: this template is intentionally NOT added to the email-template
 * variable inventory (docs/plans/2026-07-17-email-template-variables-inventory
 * .json) — the registry contract test asserts registry length equals the
 * inventory length, and the hour-block template ships outside that v1 inventory
 * scope.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  let invoicesCategory = await knex('notification_categories')
    .where({ name: 'Invoices' })
    .first();

  if (!invoicesCategory) {
    [invoicesCategory] = await knex('notification_categories')
      .insert({
        name: 'Invoices',
        description: 'Notifications related to billing and invoices',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
  }

  const existingSubtype = await knex('notification_subtypes')
    .where({ name: 'Hour Block Expiring' })
    .first();

  let subtype;
  if (existingSubtype) {
    subtype = existingSubtype;
  } else {
    [subtype] = await knex('notification_subtypes')
      .insert({
        category_id: invoicesCategory.id,
        name: 'Hour Block Expiring',
        description: 'When prepaid hour blocks are about to expire',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
  }

  const existingTemplate = await knex('system_email_templates')
    .where({ name: 'hour-block-expiring' })
    .first();

  if (!existingTemplate) {
    await knex('system_email_templates').insert({
      name: 'hour-block-expiring',
      subject: 'Prepaid Hours Expiring Soon: {{company.name}}',
      notification_subtype_id: subtype.id,
      html_content: `
        <h2>Prepaid Hours Expiring Soon</h2>
        <p>Prepaid hours for {{company.name}} will expire soon:</p>
        <div class="details">
          <p><strong>Company:</strong> {{company.name}}</p>
          <p><strong>Total Hours Remaining:</strong> {{hourBlocks.totalRemainingHours}} hrs</p>
          <p><strong>Expiration Date:</strong> {{hourBlocks.expirationDate}}</p>
          <p><strong>Days Until Expiration:</strong> {{hourBlocks.daysRemaining}}</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Service</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Hours Remaining</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Expiration Date</th>
            </tr>
          </thead>
          <tbody>
            {{#each hourBlocks.items}}
            <tr>
              <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.serviceName}}</td>
              <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.remainingHours}}</td>
              <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.expirationDate}}</td>
            </tr>
            {{/each}}
          </tbody>
        </table>
        <p style="margin-top: 20px;">Please use these prepaid hours before they expire.</p>
        <a href="{{hourBlocks.url}}" class="button">View Billing</a>
      `,
      text_content: `
Prepaid Hours Expiring Soon

Prepaid hours for {{company.name}} will expire soon:

Company: {{company.name}}
Total Hours Remaining: {{hourBlocks.totalRemainingHours}} hrs
Expiration Date: {{hourBlocks.expirationDate}}
Days Until Expiration: {{hourBlocks.daysRemaining}}

Hour Block Details:
{{#each hourBlocks.items}}
- {{this.serviceName}}: {{this.remainingHours}} hrs remaining, expires {{this.expirationDate}}
{{/each}}

Please use these prepaid hours before they expire.

View billing at: {{hourBlocks.url}}
      `
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex('system_email_templates')
    .where({ name: 'hour-block-expiring' })
    .del();

  const deletedSubtype = await knex('notification_subtypes')
    .where({ name: 'Hour Block Expiring' })
    .del();

  const invoicesCategory = await knex('notification_categories')
    .where({ name: 'Invoices' })
    .first();

  if (invoicesCategory && deletedSubtype > 0) {
    const remainingSubtypes = await knex('notification_subtypes')
      .where({ category_id: invoicesCategory.id })
      .count('* as count')
      .first();

    if (remainingSubtypes && remainingSubtypes.count === '0') {
      await knex('notification_categories')
        .where({ id: invoicesCategory.id })
        .del();
    }
  }
};
