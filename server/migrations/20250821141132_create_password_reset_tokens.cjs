exports.up = async function(knex) {
  // Create password_reset_tokens table
  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('token_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('user_id').notNullable();
    table.text('token').notNullable();
    table.text('email').notNullable();
    table.enu('user_type', ['msp', 'client']).notNullable().defaultTo('msp');
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

  // Create email template for password reset
  await knex('email_templates').insert({
    template_id: knex.raw('gen_random_uuid()'),
    template_name: 'password-reset',
    template_type: 'password-reset',
    subject: 'Password Reset Request',
    body_html: `
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
                <p>&copy; {{currentYear}} {{companyName}}. All rights reserved.</p>
            </div>
        </div>
    </div>
</body>
</html>`,
    body_text: `Hello {{userName}},

We received a request to reset your password for your account associated with {{email}}.

To reset your password, please visit the following link:
{{resetLink}}

Important: This password reset link will expire in {{expirationTime}}. If you did not request a password reset, please ignore this email or contact support if you have concerns.

For security reasons, this link can only be used once.

If you're having trouble, please contact support at {{supportEmail}}

© {{currentYear}} {{companyName}}. All rights reserved.`,
    variables: JSON.stringify([
      'userName',
      'email', 
      'resetLink',
      'expirationTime',
      'supportEmail',
      'companyName',
      'currentYear'
    ]),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
    is_system: true
  }).onConflict('template_name').ignore();
};

exports.down = async function(knex) {
  // Remove the email template
  await knex('email_templates')
    .where('template_name', 'password-reset')
    .del();
  
  // Drop the table
  await knex.schema.dropTableIfExists('password_reset_tokens');
};