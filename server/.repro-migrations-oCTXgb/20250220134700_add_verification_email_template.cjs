/**
 * Add verification email template to system_email_templates
 */
exports.up = async function(knex) {
  // Check if registration category exists
  let registrationCategory = await knex('notification_categories')
    .where({ name: 'Registration' })
    .first();

  if (!registrationCategory) {
    // Create new category if it doesn't exist
    [registrationCategory] = await knex('notification_categories')
      .insert({
        name: 'Registration',
        description: 'Account registration and verification notifications'
      })
      .returning('*');
  } else {
    // Update existing category
    [registrationCategory] = await knex('notification_categories')
      .where({ id: registrationCategory.id })
      .update({
        description: 'Account registration and verification notifications'
      })
      .returning('*');
  }

  // Check if notification subtype exists
  let verificationSubtype = await knex('notification_subtypes')
    .where({ name: 'email-verification' })
    .first();

  if (!verificationSubtype) {
    // Create new subtype if it doesn't exist
    [verificationSubtype] = await knex('notification_subtypes')
      .insert({
        category_id: registrationCategory.id,
        name: 'email-verification',
        description: 'Email verification for new registrations',
        is_enabled: true,
        is_default_enabled: true,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
  } else {
    // Update existing subtype
    [verificationSubtype] = await knex('notification_subtypes')
      .where({ id: verificationSubtype.id })
      .update({
        category_id: registrationCategory.id,
        description: 'Email verification for new registrations',
        updated_at: new Date()
      })
      .returning('*');
  }

  // Check if email template exists
  let emailTemplate = await knex('system_email_templates')
    .where({ name: 'email-verification' })
    .first();

  const templateData = {
    name: 'email-verification',
    notification_subtype_id: verificationSubtype.id,
    subject: 'Verify your email address for {{registrationCompanyName}}',
    created_at: new Date(),
    updated_at: new Date(),
    html_content: `
          <h2>Email Verification</h2>
          <div class="details">
            <p><strong>Company:</strong> {{registrationCompanyName}}</p>
            <p><strong>Email:</strong> {{email}}</p>
          </div>
          <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
          <div style="text-align: center;">
            <a href="{{verificationUrl}}" class="button">Verify Email Address</a>
          </div>
          <p>If the button doesn't work, you can also click this link:<br>
            <a href="{{verificationUrl}}">{{verificationUrl}}</a>
          </p>
          <p>This verification link will expire in 24 hours.</p>
          <div class="footer">
            <p>If you didn't request this email, please ignore it or contact {{tenantCompanyName}}.</p>
            <p>&copy; {{currentYear}} {{tenantCompanyName}}. All rights reserved.</p>
          </div>
    `,
    text_content: `
  Email Verification
  
  Thank you for registering with {{registrationCompanyName}}.
  
  Company: {{registrationCompanyName}}
  Email: {{email}}
  
  Please verify your email address by clicking the link below:
  {{verificationUrl}}
  
  This verification link will expire in 24 hours.
  
  If you didn't request this email, please ignore it or contact {{tenantCompanyName}}.
  
  © {{currentYear}} {{tenantCompanyName}}. All rights reserved.
    `
  };

  if (!emailTemplate) {
    // Create new template if it doesn't exist
    await knex('system_email_templates').insert(templateData);
  } else {
    // Update existing template
    await knex('system_email_templates')
      .where({ id: emailTemplate.id })
      .update({
        ...templateData,
        updated_at: new Date()
      });
  }
};

exports.down = async function(knex) {
  // Delete the template
  await knex('system_email_templates')
    .where({ name: 'email-verification' })
    .del();

  // Delete the subtype
  await knex('notification_subtypes')
    .where({ name: 'email-verification' })
    .del();

  // Check if registration category has other subtypes
  const subtypeCount = await knex('notification_subtypes')
    .where({ category_id: knex('notification_categories').where({ name: 'Registration' }).select('id') })
    .count('id as count')
    .first();

  // If no other subtypes, delete the category
  if (subtypeCount && Number(subtypeCount.count) === 0) {
    await knex('notification_categories')
      .where({ name: 'Registration' })
      .del();
  }
};
