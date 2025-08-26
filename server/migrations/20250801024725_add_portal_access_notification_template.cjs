/**
 * Add Portal Access notification template to system_email_templates
 */
exports.up = async function(knex) {
  // Check if Portal Access category exists
  let portalAccessCategory = await knex('notification_categories')
    .where({ name: 'Portal Access' })
    .first();

  if (!portalAccessCategory) {
    // Create new category if it doesn't exist
    [portalAccessCategory] = await knex('notification_categories')
      .insert({
        name: 'Portal Access',
        description: 'Customer portal access and invitation notifications',
        is_enabled: true,
        is_default_enabled: true,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
  } else {
    // Update existing category
    [portalAccessCategory] = await knex('notification_categories')
      .where({ id: portalAccessCategory.id })
      .update({
        description: 'Customer portal access and invitation notifications',
        updated_at: new Date()
      })
      .returning('*');
  }

  // Check if portal invitation subtype exists
  let portalInvitationSubtype = await knex('notification_subtypes')
    .where({ name: 'portal-invitation' })
    .first();

  if (!portalInvitationSubtype) {
    // Create new subtype if it doesn't exist
    [portalInvitationSubtype] = await knex('notification_subtypes')
      .insert({
        category_id: portalAccessCategory.id,
        name: 'portal-invitation',
        description: 'Portal access invitation emails for contacts',
        is_enabled: true,
        is_default_enabled: true,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
  } else {
    // Update existing subtype
    [portalInvitationSubtype] = await knex('notification_subtypes')
      .where({ id: portalInvitationSubtype.id })
      .update({
        category_id: portalAccessCategory.id,
        description: 'Portal access invitation emails for contacts',
        updated_at: new Date()
      })
      .returning('*');
  }

  // Check if email template exists
  let emailTemplate = await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .first();

  const templateData = {
    name: 'portal-invitation',
    notification_subtype_id: portalInvitationSubtype.id,
    subject: 'Portal Access Invitation - {{companyName}}',
    created_at: new Date(),
    updated_at: new Date(),
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <div style="background: #f8f9fa; padding: 20px; border-bottom: 1px solid #dee2e6;">
          <h1 style="color: #495057; margin: 0; font-size: 24px;">Portal Access Invitation</h1>
        </div>
        
        <div style="padding: 30px 20px;">
          <p style="font-size: 16px; color: #495057; margin-bottom: 20px;">Hello {{contactName}},</p>
          
          <p style="font-size: 16px; color: #495057; line-height: 1.5; margin-bottom: 20px;">
            You have been invited to access the customer portal for <strong>{{companyName}}</strong>. 
            This portal will give you access to view your tickets, invoices, and other important information.
          </p>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #495057; margin: 0 0 10px 0; font-size: 18px;">Getting Started</h3>
            <p style="color: #6c757d; margin: 0; line-height: 1.5;">
              Click the button below to set up your portal account. You'll be able to create a secure password and access your information immediately.
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="{{portalLink}}" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
              Set Up Portal Access
            </a>
          </div>
          
          <p style="font-size: 14px; color: #6c757d; line-height: 1.5;">
            If the button doesn't work, you can also copy and paste this link into your browser:<br>
            <a href="{{portalLink}}" style="color: #007bff; word-break: break-all;">{{portalLink}}</a>
          </p>
          
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0;">
            <p style="color: #856404; margin: 0; font-size: 14px;">
              <strong>Important:</strong> This invitation link will expire in {{expirationTime}}. 
              Please complete your account setup before then.
            </p>
          </div>
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; border-top: 1px solid #dee2e6; text-align: center;">
          <p style="color: #6c757d; margin: 0; font-size: 12px;">
            If you didn't expect this invitation or have questions, please contact us.
          </p>
          <p style="color: #6c757d; margin: 10px 0 0 0; font-size: 12px;">
            &copy; {{currentYear}} {{companyName}}. All rights reserved.
          </p>
        </div>
      </div>
    `,
    text_content: `
Portal Access Invitation - {{companyName}}

Hello {{contactName}},

You have been invited to access the customer portal for {{companyName}}. This portal will give you access to view your tickets, invoices, and other important information.

Getting Started:
Click the link below to set up your portal account. You'll be able to create a secure password and access your information immediately.

Portal Setup Link: {{portalLink}}

IMPORTANT: This invitation link will expire in {{expirationTime}}. Please complete your account setup before then.

If you didn't expect this invitation or have questions, please contact us.

© {{currentYear}} {{companyName}}. All rights reserved.
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
    .where({ name: 'portal-invitation' })
    .del();

  // Delete the subtype
  await knex('notification_subtypes')
    .where({ name: 'portal-invitation' })
    .del();

  // Check if Portal Access category has other subtypes
  const portalAccessCategory = await knex('notification_categories')
    .where({ name: 'Portal Access' })
    .first();

  if (portalAccessCategory) {
    const subtypeCount = await knex('notification_subtypes')
      .where({ category_id: portalAccessCategory.id })
      .count('id as count')
      .first();

    // If no other subtypes, delete the category
    if (subtypeCount && Number(subtypeCount.count) === 0) {
      await knex('notification_categories')
        .where({ name: 'Portal Access' })
        .del();
    }
  }
};