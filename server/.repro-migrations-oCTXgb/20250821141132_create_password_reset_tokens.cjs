exports.up = async function(knex) {
  // Create password_reset_tokens table
  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('token_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('user_id').notNullable();
    table.text('token').notNullable();
    table.text('email').notNullable();
    table.enu('user_type', ['internal', 'client']).notNullable().defaultTo('internal');
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('used_at', { useTz: true });
    table.jsonb('metadata').defaultTo('{}');
    
    // Primary key
    table.primary(['tenant', 'token_id']);
    
    // Foreign key constraints
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'user_id']).references(['tenant', 'user_id']).inTable('users');
    
    // Indexes for performance
    table.index(['tenant', 'token'], 'idx_password_reset_tokens_token');
    table.index(['tenant', 'user_id'], 'idx_password_reset_tokens_user');
    table.index(['tenant', 'expires_at'], 'idx_password_reset_tokens_expires');
    table.index(['tenant', 'email'], 'idx_password_reset_tokens_email');
    
    // Unique constraint on token per tenant for CitusDB compatibility
    table.unique(['tenant', 'token'], 'unique_password_reset_tenant_token');
  });

  // Check if password reset notification subtype exists
  let passwordResetSubtype = await knex('notification_subtypes')
    .where({ name: 'password-reset' })
    .first();

  if (!passwordResetSubtype) {
    // Get or create User Account category
    let userAccountCategory = await knex('notification_categories')
      .where({ name: 'User Account' })
      .first();
    
    if (!userAccountCategory) {
      [userAccountCategory] = await knex('notification_categories')
        .insert({
          name: 'User Account',
          description: 'User account related notifications',
          is_enabled: true,
          is_default_enabled: true,
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');
    }

    // Create password reset subtype
    [passwordResetSubtype] = await knex('notification_subtypes')
      .insert({
        category_id: userAccountCategory.id,
        name: 'password-reset',
        description: 'Password reset request notifications',
        is_enabled: true,
        is_default_enabled: true,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
  }

  // Check if email template exists
  const existingTemplate = await knex('system_email_templates')
    .where({ name: 'password-reset' })
    .first();

  if (!existingTemplate) {
    // Create email template for password reset
    await knex('system_email_templates').insert({
      name: 'password-reset',
      notification_subtype_id: passwordResetSubtype.id,
      subject: 'Password Reset Request',
      html_content: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset Request</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4a5568; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background-color: #f7fafc; padding: 30px; border-radius: 0 0 5px 5px; }
        .button { display: inline-block; padding: 12px 30px; background-color: #4299e1; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .warning { background-color: #fff5f5; border-left: 4px solid #feb2b2; padding: 10px; margin: 20px 0; }
        .footer { text-align: center; color: #718096; font-size: 14px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Password Reset Request</h1>
        </div>
        <div class="content">
            <p>Hello {{userName}},</p>
            
            <p>We received a request to reset your password for your account associated with {{email}}.</p>
            
            <p>To reset your password, please click the button below:</p>
            
            <div style="text-align: center;">
                <a href="{{resetLink}}" class="button">Reset Your Password</a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #4299e1;">{{resetLink}}</p>
            
            <div class="warning">
                <strong>Important:</strong> This password reset link will expire in {{expirationTime}}. If you did not request a password reset, please ignore this email or contact support if you have concerns.
            </div>
            
            <p>For security reasons, this link can only be used once.</p>
            
            <div class="footer">
                <p>If you're having trouble, please contact support at {{supportEmail}}</p>
                <p>&copy; {{currentYear}} {{clientName}}. All rights reserved.</p>
            </div>
        </div>
    </div>
</body>
</html>`,
      text_content: `Hello {{userName}},

We received a request to reset your password for your account associated with {{email}}.

To reset your password, please visit the following link:
{{resetLink}}

Important: This password reset link will expire in {{expirationTime}}. If you did not request a password reset, please ignore this email or contact support if you have concerns.

For security reasons, this link can only be used once.

If you're having trouble, please contact support at {{supportEmail}}

© {{currentYear}} {{clientName}}. All rights reserved.`,
      created_at: new Date(),
      updated_at: new Date()
    });
  }
};

exports.down = async function(knex) {
  // Remove the email template
  await knex('system_email_templates')
    .where({ name: 'password-reset' })
    .del();
  
  // Remove the notification subtype
  await knex('notification_subtypes')
    .where({ name: 'password-reset' })
    .del();
  
  // Check if User Account category has other subtypes
  const userAccountCategory = await knex('notification_categories')
    .where({ name: 'User Account' })
    .first();

  if (userAccountCategory) {
    const subtypeCount = await knex('notification_subtypes')
      .where({ category_id: userAccountCategory.id })
      .count('id as count')
      .first();

    // If no other subtypes, delete the category
    if (subtypeCount && Number(subtypeCount.count) === 0) {
      await knex('notification_categories')
        .where({ name: 'User Account' })
        .del();
    }
  }
  
  // Drop the table
  await knex.schema.dropTableIfExists('password_reset_tokens');
};