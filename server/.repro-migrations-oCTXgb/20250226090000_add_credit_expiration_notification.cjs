/**
 * Migration to add Credit Expiring notification subtype and email template
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Get or create the Invoices category
  let invoicesCategory = await knex('notification_categories')
    .where({ name: 'Invoices' })
    .first();
    
  if (!invoicesCategory) {
    // Create the Invoices category if it doesn't exist
    console.log('Creating Invoices notification category...');
    [invoicesCategory] = await knex('notification_categories')
      .insert({
        name: 'Invoices',
        description: 'Notifications related to billing and invoices',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
  }
  
  // Add the Credit Expiring notification subtype
  const [creditExpiringSubtype] = await knex('notification_subtypes')
    .insert({
      category_id: invoicesCategory.id,
      name: 'Credit Expiring',
      description: 'When credits are about to expire',
      is_enabled: true,
      is_default_enabled: true
    })
    .returning('*');
    
  // Add the email template
  await knex('system_email_templates').insert({
    name: 'credit-expiring',
    subject: 'Credits Expiring Soon: {{company.name}}',
    notification_subtype_id: creditExpiringSubtype.id,
    html_content: `
      <h2>Credits Expiring Soon</h2>
      <p>The following credits for {{company.name}} will expire soon:</p>
      <div class="details">
        <p><strong>Company:</strong> {{company.name}}</p>
        <p><strong>Total Expiring Amount:</strong> {{credits.totalAmount}}</p>
        <p><strong>Expiration Date:</strong> {{credits.expirationDate}}</p>
        <p><strong>Days Until Expiration:</strong> {{credits.daysRemaining}}</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Credit ID</th>
            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Amount</th>
            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Expiration Date</th>
            <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Original Transaction</th>
          </tr>
        </thead>
        <tbody>
          {{#each credits.items}}
          <tr>
            <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.creditId}}</td>
            <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.amount}}</td>
            <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.expirationDate}}</td>
            <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.transactionId}}</td>
          </tr>
          {{/each}}
        </tbody>
      </table>
      <p style="margin-top: 20px;">Please use these credits before they expire to avoid losing them.</p>
      <a href="{{credits.url}}" class="button">View Credits</a>
    `,
    text_content: `
Credits Expiring Soon

The following credits for {{company.name}} will expire soon:

Company: {{company.name}}
Total Expiring Amount: {{credits.totalAmount}}
Expiration Date: {{credits.expirationDate}}
Days Until Expiration: {{credits.daysRemaining}}

Credit Details:
{{#each credits.items}}
- Credit ID: {{this.creditId}}
  Amount: {{this.amount}}
  Expiration Date: {{this.expirationDate}}
  Original Transaction: {{this.transactionId}}
{{/each}}

Please use these credits before they expire to avoid losing them.

View credits at: {{credits.url}}
    `
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Delete the email template
  await knex('system_email_templates')
    .where({ name: 'credit-expiring' })
    .del();
    
  // Delete the notification subtype
  const deletedSubtype = await knex('notification_subtypes')
    .where({ name: 'Credit Expiring' })
    .del();
  
  // Check if we need to clean up the Invoices category
  // Only delete it if there are no other subtypes using it
  const invoicesCategory = await knex('notification_categories')
    .where({ name: 'Invoices' })
    .first();
    
  if (invoicesCategory) {
    const remainingSubtypes = await knex('notification_subtypes')
      .where({ category_id: invoicesCategory.id })
      .count('* as count')
      .first();
      
    if (remainingSubtypes && remainingSubtypes.count === '0') {
      console.log('No remaining subtypes for Invoices category, deleting it...');
      await knex('notification_categories')
        .where({ id: invoicesCategory.id })
        .del();
    }
  }
};