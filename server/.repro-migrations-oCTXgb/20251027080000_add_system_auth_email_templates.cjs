/**
 * Add system authentication email templates to database
 *
 * This migration adds email_verification, password_reset, and portal-invitation
 * templates to system_email_templates for all supported languages.
 *
 * This allows us to remove hardcoded templates from i18nSystemEmailService
 * and manage all templates consistently through the database.
 */

exports.up = async function(knex) {
  console.log('Adding system authentication email templates...');

  // Drop old unique constraint on name only if it exists
  await knex.raw('ALTER TABLE system_email_templates DROP CONSTRAINT IF EXISTS system_email_templates_name_unique');
  await knex.raw('ALTER TABLE system_email_templates DROP CONSTRAINT IF EXISTS system_email_templates_name_key');

  // Ensure composite unique constraint exists
  await knex.raw('ALTER TABLE system_email_templates DROP CONSTRAINT IF EXISTS system_email_templates_name_language_key');
  await knex.raw('ALTER TABLE system_email_templates ADD CONSTRAINT system_email_templates_name_language_key UNIQUE (name, language_code)');

  // Fetch or create notification subtype IDs
  const subtypeIds = {};

  // Ensure Authentication category exists
  let authCategory = await knex('notification_categories')
    .where({ name: 'Authentication' })
    .first();

  if (!authCategory) {
    [authCategory] = await knex('notification_categories')
      .insert({
        name: 'Authentication',
        description: 'Authentication and security notifications',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
  }

  const existingSubtypes = ['email-verification', 'password-reset', 'portal-invitation'];
  const existingSubtypeDescriptions = {
    'email-verification': 'Email verification instructions for new users',
    'password-reset': 'Password reset instructions for users',
    'portal-invitation': 'Invitation email for customer portal access'
  };

  for (const name of existingSubtypes) {
    let subtype = await knex('notification_subtypes')
      .where({ name })
      .first();

    if (!subtype) {
      [subtype] = await knex('notification_subtypes')
        .insert({
          category_id: authCategory.id,
          name,
          description: existingSubtypeDescriptions[name] ?? name,
          is_enabled: true,
          is_default_enabled: true
        })
        .returning('*');
      console.log(`✓ Created notification subtype: ${name}`);
    }

    subtypeIds[name] = subtype.id;
  }

  // Create new subtypes for tenant-recovery and no-account-found if they don't exist
  const newSubtypes = {
    'tenant-recovery': 'Tenant/organization account recovery and login links',
    'no-account-found': 'Notification when no account is found for email address'
  };

  for (const [name, description] of Object.entries(newSubtypes)) {
    let subtype = await knex('notification_subtypes')
      .where({ name })
      .first();

    if (!subtype && authCategory) {
      [subtype] = await knex('notification_subtypes')
        .insert({
          category_id: authCategory.id,
          name,
          description,
          is_enabled: true,
          is_default_enabled: true
        })
        .returning('*');
      console.log(`✓ Created notification subtype: ${name}`);
    }

    if (subtype) {
      subtypeIds[name] = subtype.id;
    }
  }

  console.log('✓ Authentication notification subtypes ready:', Object.keys(subtypeIds));

  // Create Tickets and Invoices categories if they don't exist
  const ticketsCategory = await knex('notification_categories')
    .where({ name: 'Tickets' })
    .first() || (await knex('notification_categories')
      .insert({
        name: 'Tickets',
        description: 'Notifications related to support tickets',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*'))[0];

  const invoicesCategory = await knex('notification_categories')
    .where({ name: 'Invoices' })
    .first() || (await knex('notification_categories')
      .insert({
        name: 'Invoices',
        description: 'Notifications related to billing and invoices',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*'))[0];

  // Create ticket notification subtypes if they don't exist
  const ticketSubtypes = {
    'Ticket Assigned': 'When a ticket is assigned to a user',
    'Ticket Created': 'When a new ticket is created',
    'Ticket Updated': 'When a ticket is modified',
    'Ticket Closed': 'When a ticket is closed',
    'Ticket Comment Added': 'When a comment is added to a ticket'
  };

  for (const [name, description] of Object.entries(ticketSubtypes)) {
    let subtype = await knex('notification_subtypes')
      .where({ name })
      .first();

    if (!subtype) {
      [subtype] = await knex('notification_subtypes')
        .insert({
          category_id: ticketsCategory.id,
          name,
          description,
          is_enabled: true,
          is_default_enabled: true
        })
        .returning('*');
      console.log(`✓ Created notification subtype: ${name}`);
    }

    subtypeIds[name] = subtype.id;
  }

  // Create invoice notification subtypes if they don't exist
  const invoiceSubtypes = {
    'Invoice Generated': 'When a new invoice is generated',
    'Payment Received': 'When a payment is received',
    'Payment Overdue': 'When an invoice payment is overdue'
  };

  for (const [name, description] of Object.entries(invoiceSubtypes)) {
    let subtype = await knex('notification_subtypes')
      .where({ name })
      .first();

    if (!subtype) {
      [subtype] = await knex('notification_subtypes')
        .insert({
          category_id: invoicesCategory.id,
          name,
          description,
          is_enabled: true,
          is_default_enabled: true
        })
        .returning('*');
      console.log(`✓ Created notification subtype: ${name}`);
    }

    subtypeIds[name] = subtype.id;
  }

  console.log('✓ All notification subtypes ready:', Object.keys(subtypeIds));

  // Delete ALL existing portal-invitation templates (all languages)
  // This ensures we update templates with correct styling and variable names
  console.log('Removing old portal-invitation templates...');
  await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .del();
  console.log('✓ Old portal-invitation templates removed');

  // English templates
  await knex('system_email_templates').insert([
    {
      name: 'email-verification',
      language_code: 'en',
      subject: 'Verify your email{{#if registrationClientName}} for {{registrationClientName}}{{/if}}',
      notification_subtype_id: subtypeIds['email-verification'],
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Email Verification</h2>
          <p>Hello,</p>
          <p>Please verify your email address by clicking the link below:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
          <p>Or copy and paste this link into your browser:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>This link will expire in {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">If you didn't request this email, please ignore it.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `Email Verification

Please verify your email address by visiting:
{{verificationUrl}}

{{#if expirationTime}}This link will expire in {{expirationTime}}.{{/if}}

If you didn't request this email, please ignore it.

© {{currentYear}} {{tenantClientName}}`,
      notification_subtype_id: subtypeIds['email-verification']
    },
    {
      name: 'password-reset',
      language_code: 'en',
      subject: 'Password Reset Request',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset</h2>
          <p>Hello {{userName}},</p>
          <p>You requested to reset your password for {{email}}. Click the link below to proceed:</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
          <p>Or copy and paste this link into your browser:</p>
          <p>{{resetLink}}</p>
          <p><small>This link will expire in {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">Need help? Contact {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Password Reset Request

Hello {{userName}},

You requested to reset your password for {{email}}. Visit the following link:
{{resetLink}}

This link will expire in {{expirationTime}}.

If you didn't request this password reset, please ignore this email.
{{#if supportEmail}}Need help? Contact {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`,
      notification_subtype_id: subtypeIds['password-reset']
    },
    {
      name: 'portal-invitation',
      language_code: 'en',
      subject: 'Portal Invitation - {{clientName}}',
      html_content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portal Access Invitation</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .header {
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 32px 24px;
      border-radius: 12px 12px 0 0;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      opacity: 1;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.95);
    }
    .content {
      background: #ffffff;
      padding: 32px;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-bottom: none;
    }
    .footer {
      background: #1e293b;
      color: #cbd5e1;
      padding: 24px;
      border-radius: 0 0 12px 12px;
      text-align: center;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: #cbd5e1;
    }
    .footer p:last-child {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 16px;
    }
    .info-box {
      background: #faf8ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e9e5f5;
      border-left: 4px solid #8a4dea;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .info-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .info-box p {
      margin: 8px 0;
      color: #334155;
    }
    .action-button {
      display: inline-block;
      background: #8a4dea;
      color: #ffffff !important;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 24px 0;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 16px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .action-button:hover {
      background: #7c3aed;
      color: #ffffff !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .warning h4 {
      color: #92400e;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning p {
      margin: 0;
      color: #92400e;
    }
    .contact-info {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    .contact-info h4 {
      color: #0f172a;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .contact-info p {
      margin: 4px 0;
      color: #334155;
      font-size: 14px;
    }
    h2 {
      color: #0f172a;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: #334155;
      margin: 0 0 16px 0;
    }
    a {
      color: #8a4dea;
      text-decoration: underline;
    }
    a:hover {
      color: #7c3aed;
    }
    .tagline {
      background: #faf8ff;
      border-left: 3px solid #8a4dea;
      padding: 20px 24px;
      margin: 24px 0;
      font-style: normal;
      color: #334155;
      border-radius: 6px;
      line-height: 1.7;
    }
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: #64748b;
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Welcome to Your Customer Portal</h1>
    <p>You're invited to access your account</p>
  </div>

  <div class="content">
    <h2>Hello {{contactName}},</h2>

    <p>Great news! You've been invited to access the customer portal for <strong>{{clientName}}</strong>. This secure portal gives you instant access to:</p>

    <div class="info-box">
      <h3>🎯 What You Can Access</h3>
      <p>✓ View and track your support tickets</p>
      <p>✓ Review project updates and documentation</p>
      <p>✓ Communicate directly with your support team</p>
    </div>

    <div class="tagline">
      Experience seamless service management with our intuitive portal. Everything you need to stay informed and connected, all in one secure location.
    </div>

    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">Set Up Your Portal Access</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Or copy and paste this link into your browser:
    </p>
    <div class="link-text">{{portalLink}}</div>

    <div class="warning">
      <h4>⏰ Time-Sensitive Invitation</h4>
      <p>This invitation link will expire in <strong>{{expirationTime}}</strong>. Please complete your account setup before then to ensure uninterrupted access.</p>
    </div>

    <div class="divider"></div>

    <div class="contact-info">
      <h4>Need Assistance?</h4>
      <p><strong>Email:</strong> {{clientLocationEmail}}</p>
      <p><strong>Phone:</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Our support team is ready to help you get started.</p>
    </div>
  </div>

  <div class="footer">
    <p>This email was sent to {{contactName}} as part of your portal access setup.</p>
    <p>If you didn't expect this invitation, please contact us at {{clientLocationEmail}}.</p>
    <p>© {{currentYear}} {{clientName}}. All rights reserved.</p>
  </div>
</body>
</html>`,
      text_content: `Welcome to Your Customer Portal

Hello {{contactName}},

Great news! You've been invited to access the customer portal for {{clientName}}. This secure portal gives you instant access to:

✓ View and track your support tickets
✓ Review project updates and documentation
✓ Communicate directly with your support team

Experience seamless service management with our intuitive portal. Everything you need to stay informed and connected, all in one secure location.

Set Up Your Portal Access: {{portalLink}}

⏰ Time-Sensitive Invitation
This invitation link will expire in {{expirationTime}}. Please complete your account setup before then to ensure uninterrupted access.

Need Assistance?
Email: {{clientLocationEmail}}
Phone: {{clientLocationPhone}}
Our support team is ready to help you get started.

---
This email was sent to {{contactName}} as part of your portal access setup.
If you didn't expect this invitation, please contact us at {{clientLocationEmail}}.
© {{currentYear}} {{clientName}}. All rights reserved.`,
      notification_subtype_id: subtypeIds['portal-invitation']
    },
    {
      name: 'tenant-recovery',
      language_code: 'en',
      subject: '{{platformName}} - Your Login Links',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hello,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              You requested access to your client portal{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}We found {{tenantCount}} organizations associated with your email address.{{else}}Here is your login link:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Security Note:</strong> If you didn't request these login links, you can safely ignore this email. Your account remains secure.
              </p>
            </div>

            <p style="color: #6b7280; font-size: 14px; margin-top: 25px;">
              If you have any questions or need assistance, please contact your organization's support team.
            </p>
          </div>
          <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">© {{currentYear}} {{platformName}}. All rights reserved.</p>
            <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Your Login Links

Hello,

You requested access to your client portal{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}We found {{tenantCount}} organizations associated with your email address.{{else}}Here is your login link:{{/if}}

Your Login Links:
{{tenantLinksText}}

Security Note: If you didn't request these login links, you can safely ignore this email. Your account remains secure.

If you have any questions or need assistance, please contact your organization's support team.

---
© {{currentYear}} {{platformName}}. All rights reserved.
This is an automated message. Please do not reply to this email.`,
      notification_subtype_id: subtypeIds['tenant-recovery']
    },
    {
      name: 'no-account-found',
      language_code: 'en',
      subject: '{{platformName}} - Access Request',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hello,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              We received a request to access the client portal using this email address.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              If you have an account with us, you should have received a separate email with your login links.
              If you didn't receive a login email, it may mean:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>This email address is not associated with any client portal accounts</li>
              <li>Your account may be inactive</li>
              <li>The email may have been filtered to your spam folder</li>
            </ul>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Need Help?</strong> If you believe you should have access to a client portal, please contact your service provider's support team for assistance.
              </p>
            </div>

            <div style="background-color: #fef3c7; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #92400e; font-size: 14px; margin: 0;">
                <strong>Security Note:</strong> If you didn't request access, you can safely ignore this email.
              </p>
            </div>
          </div>
          <div style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">© {{currentYear}} {{platformName}}. All rights reserved.</p>
            <p style="color: #9ca3af; font-size: 11px; margin: 10px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Access Request

Hello,

We received a request to access the client portal using this email address.

If you have an account with us, you should have received a separate email with your login links.
If you didn't receive a login email, it may mean:

- This email address is not associated with any client portal accounts
- Your account may be inactive
- The email may have been filtered to your spam folder

Need Help? If you believe you should have access to a client portal, please contact your service provider's support team for assistance.

Security Note: If you didn't request access, you can safely ignore this email.

---
© {{currentYear}} {{platformName}}. All rights reserved.
This is an automated message. Please do not reply to this email.`,
      notification_subtype_id: subtypeIds['no-account-found']
    }
  ]).onConflict(['name', 'language_code']).ignore();

  console.log('✓ English system auth templates added (including tenant-recovery)');

  // French templates
  await knex('system_email_templates').insert([
    {
      name: 'email-verification',
      language_code: 'fr',
      subject: 'Vérifiez votre email{{#if registrationClientName}} pour {{registrationClientName}}{{/if}}',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Vérification d'email</h2>
          <p>Bonjour,</p>
          <p>Veuillez vérifier votre adresse email en cliquant sur le lien ci-dessous :</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Vérifier l'email</a></p>
          <p>Ou copiez et collez ce lien dans votre navigateur :</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Ce lien expirera dans {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si vous n'avez pas demandé cet email, veuillez l'ignorer.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `Vérification d'email

Veuillez vérifier votre adresse email en visitant :
{{verificationUrl}}

{{#if expirationTime}}Ce lien expirera dans {{expirationTime}}.{{/if}}

Si vous n'avez pas demandé cet email, veuillez l'ignorer.

© {{currentYear}} {{tenantClientName}}`,
      notification_subtype_id: subtypeIds['email-verification']
    },
    {
      name: 'password-reset',
      language_code: 'fr',
      subject: 'Demande de réinitialisation du mot de passe',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Réinitialisation du mot de passe</h2>
          <p>Bonjour {{userName}},</p>
          <p>Vous avez demandé à réinitialiser votre mot de passe pour {{email}}. Cliquez sur le lien ci-dessous pour continuer :</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Réinitialiser le mot de passe</a></p>
          <p>Ou copiez et collez ce lien dans votre navigateur :</p>
          <p>{{resetLink}}</p>
          <p><small>Ce lien expirera dans {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email. Votre mot de passe restera inchangé.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">Besoin d'aide ? Contactez {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Demande de réinitialisation du mot de passe

Bonjour {{userName}},

Vous avez demandé à réinitialiser votre mot de passe pour {{email}}. Visitez le lien suivant :
{{resetLink}}

Ce lien expirera dans {{expirationTime}}.

Si vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.
{{#if supportEmail}}Besoin d'aide ? Contactez {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`,
      notification_subtype_id: subtypeIds['password-reset']
    },
    {
      name: 'portal-invitation',
      language_code: 'fr',
      subject: 'Invitation au portail client - {{clientName}}',
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation d'accès au portail</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .header {
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 32px 24px;
      border-radius: 12px 12px 0 0;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      opacity: 1;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.95);
    }
    .content {
      background: #ffffff;
      padding: 32px;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-bottom: none;
    }
    .footer {
      background: #1e293b;
      color: #cbd5e1;
      padding: 24px;
      border-radius: 0 0 12px 12px;
      text-align: center;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: #cbd5e1;
    }
    .footer p:last-child {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 16px;
    }
    .info-box {
      background: #faf8ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e9e5f5;
      border-left: 4px solid #8a4dea;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .info-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .info-box p {
      margin: 8px 0;
      color: #334155;
    }
    .action-button {
      display: inline-block;
      background: #8a4dea;
      color: #ffffff !important;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 24px 0;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 16px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .action-button:hover {
      background: #7c3aed;
      color: #ffffff !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .warning h4 {
      color: #92400e;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning p {
      margin: 0;
      color: #92400e;
    }
    .contact-info {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    .contact-info h4 {
      color: #0f172a;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .contact-info p {
      margin: 4px 0;
      color: #334155;
      font-size: 14px;
    }
    h2 {
      color: #0f172a;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: #334155;
      margin: 0 0 16px 0;
    }
    a {
      color: #8a4dea;
      text-decoration: underline;
    }
    a:hover {
      color: #7c3aed;
    }
    .tagline {
      background: #faf8ff;
      border-left: 3px solid #8a4dea;
      padding: 20px 24px;
      margin: 24px 0;
      font-style: normal;
      color: #334155;
      border-radius: 6px;
      line-height: 1.7;
    }
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: #64748b;
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Bienvenue sur votre portail client</h1>
    <p>Vous êtes invité à accéder à votre compte</p>
  </div>

  <div class="content">
    <h2>Bonjour {{contactName}},</h2>

    <p>Excellente nouvelle ! Vous avez été invité à accéder au portail client de <strong>{{clientName}}</strong>. Ce portail sécurisé vous donne un accès instantané à :</p>

    <div class="info-box">
      <h3>🎯 Ce à quoi vous pouvez accéder</h3>
      <p>✓ Consulter et suivre vos tickets d'assistance</p>
      <p>✓ Examiner les mises à jour et la documentation des projets</p>
      <p>✓ Communiquer directement avec votre équipe d'assistance</p>
    </div>

    <div class="tagline">
      Profitez d'une gestion de services fluide avec notre portail intuitif. Tout ce dont vous avez besoin pour rester informé et connecté, le tout dans un emplacement sécurisé.
    </div>

    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">Configurer l'accès à mon portail</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Ou copiez et collez ce lien dans votre navigateur :
    </p>
    <div class="link-text">{{portalLink}}</div>

    <div class="warning">
      <h4>⏰ Invitation à durée limitée</h4>
      <p>Ce lien d'invitation expirera dans <strong>{{expirationTime}}</strong>. Veuillez terminer la configuration de votre compte avant cette échéance pour garantir un accès ininterrompu.</p>
    </div>

    <div class="divider"></div>

    <div class="contact-info">
      <h4>Besoin d'assistance ?</h4>
      <p><strong>Email :</strong> {{clientLocationEmail}}</p>
      <p><strong>Téléphone :</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Notre équipe d'assistance est prête à vous aider à démarrer.</p>
    </div>
  </div>

  <div class="footer">
    <p>Cet email a été envoyé à {{contactName}} dans le cadre de la configuration de votre accès au portail.</p>
    <p>Si vous n'attendiez pas cette invitation, veuillez nous contacter à {{clientLocationEmail}}.</p>
    <p>© {{currentYear}} {{clientName}}. Tous droits réservés.</p>
  </div>
</body>
</html>`,
      text_content: `Bienvenue sur votre portail client

Bonjour {{contactName}},

Excellente nouvelle ! Vous avez été invité à accéder au portail client de {{clientName}}. Ce portail sécurisé vous donne un accès instantané à :

✓ Consulter et suivre vos tickets d'assistance
✓ Examiner les mises à jour et la documentation des projets
✓ Communiquer directement avec votre équipe d'assistance

CONFIGURER L'ACCÈS À MON PORTAIL :
{{portalLink}}

⏰ DURÉE LIMITÉE : Ce lien d'invitation expirera dans {{expirationTime}}. Veuillez terminer la configuration de votre compte avant cette échéance pour garantir un accès ininterrompu.

BESOIN D'ASSISTANCE ?
Email : {{clientLocationEmail}}
Téléphone : {{clientLocationPhone}}

Notre équipe d'assistance est prête à vous aider à démarrer.

---
Cet email a été envoyé à {{contactName}} dans le cadre de la configuration de votre accès au portail.
Si vous n'attendiez pas cette invitation, veuillez nous contacter à {{clientLocationEmail}}.

© {{currentYear}} {{clientName}}. Tous droits réservés.
`,
      notification_subtype_id: subtypeIds['portal-invitation']
    },
    {
      name: 'tenant-recovery',
      language_code: 'fr',
      subject: '{{platformName}} - Vos liens de connexion',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Bonjour,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Vous avez demandé l'accès à votre portail{{#if isMultiple}}s{{/if}} client{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}Nous avons trouvé {{tenantCount}} organisations associées à votre adresse e-mail.{{else}}Voici votre lien de connexion :{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Note de sécurité :</strong> Si vous n'avez pas demandé ces liens de connexion, vous pouvez ignorer cet e-mail en toute sécurité. Votre compte reste sécurisé.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Si vous avez des questions ou besoin d'assistance, veuillez contacter l'équipe d'assistance de votre organisation.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Tous droits réservés.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Vos liens de connexion

Bonjour,

Vous avez demandé l'accès à votre portail{{#if isMultiple}}s{{/if}} client{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}Nous avons trouvé {{tenantCount}} organisations associées à votre adresse e-mail.{{else}}Voici votre lien de connexion :{{/if}}

Vos liens de connexion :
{{tenantLinksText}}

Note de sécurité : Si vous n'avez pas demandé ces liens de connexion, vous pouvez ignorer cet e-mail en toute sécurité.

Si vous avez des questions ou besoin d'assistance, veuillez contacter l'équipe d'assistance de votre organisation.

---
© {{currentYear}} {{platformName}}. Tous droits réservés.
Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.`,
      notification_subtype_id: subtypeIds['tenant-recovery']
    },
    {
      name: 'no-account-found',
      language_code: 'fr',
      subject: '{{platformName}} - Demande d\'accès',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Bonjour,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Nous avons reçu une demande d'accès au portail client utilisant cette adresse e-mail.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Si vous avez un compte chez nous, vous devriez avoir reçu un e-mail séparé avec vos liens de connexion.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Si vous n'avez pas reçu d'e-mail de connexion, cela peut signifier :
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Cette adresse e-mail n'est associée à aucun compte de portail client</li>
              <li>Votre compte peut être inactif</li>
              <li>L'e-mail peut avoir été filtré vers votre dossier spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Besoin d'aide ?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Si vous pensez que vous devriez avoir accès à un portail client, veuillez contacter l'équipe d'assistance de votre fournisseur de services pour obtenir de l'aide.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Note de sécurité :</strong> Si vous n'avez pas demandé d'accès, vous pouvez ignorer cet e-mail en toute sécurité.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Tous droits réservés.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Demande d'accès

Bonjour,

Nous avons reçu une demande d'accès au portail client utilisant cette adresse e-mail.

Si vous avez un compte chez nous, vous devriez avoir reçu un e-mail séparé avec vos liens de connexion.

Si vous n'avez pas reçu d'e-mail de connexion, cela peut signifier :
- Cette adresse e-mail n'est associée à aucun compte de portail client
- Votre compte peut être inactif
- L'e-mail peut avoir été filtré vers votre dossier spam

Besoin d'aide ?
Si vous pensez que vous devriez avoir accès à un portail client, veuillez contacter l'équipe d'assistance de votre fournisseur de services pour obtenir de l'aide.

Note de sécurité : Si vous n'avez pas demandé d'accès, vous pouvez ignorer cet e-mail en toute sécurité.

---
© {{currentYear}} {{platformName}}. Tous droits réservés.
Ceci est un message automatisé. Veuillez ne pas répondre à cet e-mail.`,
      notification_subtype_id: subtypeIds['no-account-found']
    }
  ]).onConflict(['name', 'language_code']).ignore();

  console.log('✓ French system auth templates added');

  // Spanish templates
  await knex('system_email_templates').insert([
    {
      name: 'email-verification',
      language_code: 'es',
      subject: 'Verifica tu correo electrónico{{#if registrationClientName}} para {{registrationClientName}}{{/if}}',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Verificación de correo electrónico</h2>
          <p>Hola,</p>
          <p>Por favor verifica tu dirección de correo electrónico haciendo clic en el enlace a continuación:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verificar correo</a></p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Este enlace expirará en {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si no solicitaste este correo, por favor ignóralo.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `Verificación de correo electrónico

Por favor verifica tu dirección de correo electrónico visitando:
{{verificationUrl}}

{{#if expirationTime}}Este enlace expirará en {{expirationTime}}.{{/if}}

Si no solicitaste este correo, por favor ignóralo.

© {{currentYear}} {{tenantClientName}}`,
      notification_subtype_id: subtypeIds['email-verification']
    },
    {
      name: 'password-reset',
      language_code: 'es',
      subject: 'Solicitud de restablecimiento de contraseña',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Restablecimiento de contraseña</h2>
          <p>Hola {{userName}},</p>
          <p>Has solicitado restablecer tu contraseña para {{email}}. Haz clic en el enlace a continuación para continuar:</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Restablecer contraseña</a></p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p>{{resetLink}}</p>
          <p><small>Este enlace expirará en {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Si no solicitaste este restablecimiento, por favor ignora este correo. Tu contraseña permanecerá sin cambios.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">¿Necesitas ayuda? Contacta {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Solicitud de restablecimiento de contraseña

Hola {{userName}},

Has solicitado restablecer tu contraseña para {{email}}. Visita el siguiente enlace:
{{resetLink}}

Este enlace expirará en {{expirationTime}}.

Si no solicitaste este restablecimiento, por favor ignora este correo.
{{#if supportEmail}}¿Necesitas ayuda? Contacta {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`,
      notification_subtype_id: subtypeIds['password-reset']
    },
    {
      name: 'portal-invitation',
      language_code: 'es',
      subject: 'Invitación al portal del cliente - {{clientName}}',
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitación de acceso al portal</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .header {
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 32px 24px;
      border-radius: 12px 12px 0 0;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      opacity: 1;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.95);
    }
    .content {
      background: #ffffff;
      padding: 32px;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-bottom: none;
    }
    .footer {
      background: #1e293b;
      color: #cbd5e1;
      padding: 24px;
      border-radius: 0 0 12px 12px;
      text-align: center;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: #cbd5e1;
    }
    .footer p:last-child {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 16px;
    }
    .info-box {
      background: #faf8ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e9e5f5;
      border-left: 4px solid #8a4dea;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .info-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .info-box p {
      margin: 8px 0;
      color: #334155;
    }
    .action-button {
      display: inline-block;
      background: #8a4dea;
      color: #ffffff !important;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 24px 0;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 16px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .action-button:hover {
      background: #7c3aed;
      color: #ffffff !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .warning h4 {
      color: #92400e;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning p {
      margin: 0;
      color: #92400e;
    }
    .contact-info {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    .contact-info h4 {
      color: #0f172a;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .contact-info p {
      margin: 4px 0;
      color: #334155;
      font-size: 14px;
    }
    h2 {
      color: #0f172a;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: #334155;
      margin: 0 0 16px 0;
    }
    a {
      color: #8a4dea;
      text-decoration: underline;
    }
    a:hover {
      color: #7c3aed;
    }
    .tagline {
      background: #faf8ff;
      border-left: 3px solid #8a4dea;
      padding: 20px 24px;
      margin: 24px 0;
      font-style: normal;
      color: #334155;
      border-radius: 6px;
      line-height: 1.7;
    }
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: #64748b;
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Bienvenido a tu portal del cliente</h1>
    <p>Estás invitado a acceder a tu cuenta</p>
  </div>

  <div class="content">
    <h2>Hola {{contactName}},</h2>

    <p>¡Excelentes noticias! Has sido invitado a acceder al portal del cliente de <strong>{{clientName}}</strong>. Este portal seguro te brinda acceso instantáneo a:</p>

    <div class="info-box">
      <h3>🎯 A qué puedes acceder</h3>
      <p>✓ Ver y realizar seguimiento de tus tickets de soporte</p>
      <p>✓ Revisar actualizaciones y documentación de proyectos</p>
      <p>✓ Comunicarte directamente con tu equipo de soporte</p>
    </div>

    <div class="tagline">
      Experimenta una gestión de servicios sin interrupciones con nuestro portal intuitivo. Todo lo que necesitas para mantenerte informado y conectado, todo en un lugar seguro.
    </div>

    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">Configurar el acceso a mi portal</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      O copia y pega este enlace en tu navegador:
    </p>
    <div class="link-text">{{portalLink}}</div>

    <div class="warning">
      <h4>⏰ Invitación con tiempo limitado</h4>
      <p>Este enlace de invitación expirará en <strong>{{expirationTime}}</strong>. Por favor, completa la configuración de tu cuenta antes de ese momento para garantizar un acceso ininterrumpido.</p>
    </div>

    <div class="divider"></div>

    <div class="contact-info">
      <h4>¿Necesitas asistencia?</h4>
      <p><strong>Email:</strong> {{clientLocationEmail}}</p>
      <p><strong>Teléfono:</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Nuestro equipo de soporte está listo para ayudarte a comenzar.</p>
    </div>
  </div>

  <div class="footer">
    <p>Este correo fue enviado a {{contactName}} como parte de la configuración de tu acceso al portal.</p>
    <p>Si no esperabas esta invitación, por favor contáctanos en {{clientLocationEmail}}.</p>
    <p>© {{currentYear}} {{clientName}}. Todos los derechos reservados.</p>
  </div>
</body>
</html>`,
      text_content: `Bienvenido a tu portal del cliente

Hola {{contactName}},

¡Excelentes noticias! Has sido invitado a acceder al portal del cliente de {{clientName}}. Este portal seguro te brinda acceso instantáneo a:

✓ Ver y realizar seguimiento de tus tickets de soporte
✓ Revisar actualizaciones y documentación de proyectos
✓ Comunicarte directamente con tu equipo de soporte

CONFIGURAR EL ACCESO A MI PORTAL:
{{portalLink}}

⏰ TIEMPO LIMITADO: Este enlace de invitación expirará en {{expirationTime}}. Por favor, completa la configuración de tu cuenta antes de ese momento para garantizar un acceso ininterrumpido.

¿NECESITAS ASISTENCIA?
Email: {{clientLocationEmail}}
Teléfono: {{clientLocationPhone}}

Nuestro equipo de soporte está listo para ayudarte a comenzar.

---
Este correo fue enviado a {{contactName}} como parte de la configuración de tu acceso al portal.
Si no esperabas esta invitación, por favor contáctanos en {{clientLocationEmail}}.

© {{currentYear}} {{clientName}}. Todos los derechos reservados.
`,
      notification_subtype_id: subtypeIds['portal-invitation']
    },
    {
      name: 'tenant-recovery',
      language_code: 'es',
      subject: '{{platformName}} - Tus enlaces de inicio de sesión',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hola,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Solicitaste acceso a tu portal{{#if isMultiple}}es{{/if}} de cliente{{#if isMultiple}}s{{/if}}.
              {{#if isMultiple}}Encontramos {{tenantCount}} organizaciones asociadas con tu dirección de correo electrónico.{{else}}Aquí está tu enlace de inicio de sesión:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota de seguridad:</strong> Si no solicitaste estos enlaces de inicio de sesión, puedes ignorar este correo de forma segura. Tu cuenta permanece segura.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organización.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Todos los derechos reservados.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Este es un mensaje automático. Por favor no respondas a este correo.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Tus enlaces de inicio de sesión

Hola,

Solicitaste acceso a tu portal{{#if isMultiple}}es{{/if}} de cliente{{#if isMultiple}}s{{/if}}.
{{#if isMultiple}}Encontramos {{tenantCount}} organizaciones asociadas con tu dirección de correo electrónico.{{else}}Aquí está tu enlace de inicio de sesión:{{/if}}

Tus enlaces de inicio de sesión:
{{tenantLinksText}}

Nota de seguridad: Si no solicitaste estos enlaces de inicio de sesión, puedes ignorar este correo de forma segura.

Si tienes preguntas o necesitas asistencia, por favor contacta al equipo de soporte de tu organización.

---
© {{currentYear}} {{platformName}}. Todos los derechos reservados.
Este es un mensaje automático. Por favor no respondas a este correo.`,
      notification_subtype_id: subtypeIds['tenant-recovery']
    },
    {
      name: 'no-account-found',
      language_code: 'es',
      subject: '{{platformName}} - Solicitud de acceso',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hola,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Recibimos una solicitud para acceder al portal del cliente usando esta dirección de correo electrónico.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Si tienes una cuenta con nosotros, deberías haber recibido un correo separado con tus enlaces de inicio de sesión.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Si no recibiste un correo de inicio de sesión, puede significar:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Esta dirección de correo electrónico no está asociada con ninguna cuenta del portal del cliente</li>
              <li>Tu cuenta puede estar inactiva</li>
              <li>El correo puede haber sido filtrado a tu carpeta de spam</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>¿Necesitas ayuda?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Si crees que deberías tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Nota de seguridad:</strong> Si no solicitaste acceso, puedes ignorar este correo de forma segura.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Todos los derechos reservados.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Este es un mensaje automático. Por favor no respondas a este correo.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Solicitud de acceso

Hola,

Recibimos una solicitud para acceder al portal del cliente usando esta dirección de correo electrónico.

Si tienes una cuenta con nosotros, deberías haber recibido un correo separado con tus enlaces de inicio de sesión.

Si no recibiste un correo de inicio de sesión, puede significar:
- Esta dirección de correo electrónico no está asociada con ninguna cuenta del portal del cliente
- Tu cuenta puede estar inactiva
- El correo puede haber sido filtrado a tu carpeta de spam

¿Necesitas ayuda?
Si crees que deberías tener acceso a un portal del cliente, por favor contacta al equipo de soporte de tu proveedor de servicios para obtener ayuda.

Nota de seguridad: Si no solicitaste acceso, puedes ignorar este correo de forma segura.

---
© {{currentYear}} {{platformName}}. Todos los derechos reservados.
Este es un mensaje automático. Por favor no respondas a este correo.`,
      notification_subtype_id: subtypeIds['no-account-found']
    }
  ]).onConflict(['name', 'language_code']).ignore();

  console.log('✓ Spanish system auth templates added');

  // German templates
  await knex('system_email_templates').insert([
    {
      name: 'email-verification',
      language_code: 'de',
      subject: 'Verifizieren Sie Ihre E-Mail{{#if registrationClientName}} für {{registrationClientName}}{{/if}}',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>E-Mail-Verifizierung</h2>
          <p>Hallo,</p>
          <p>Bitte verifizieren Sie Ihre E-Mail-Adresse, indem Sie auf den untenstehenden Link klicken:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">E-Mail verifizieren</a></p>
          <p>Oder kopieren Sie diesen Link in Ihren Browser:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Dieser Link läuft in {{expirationTime}} ab.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Wenn Sie diese E-Mail nicht angefordert haben, ignorieren Sie sie bitte.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `E-Mail-Verifizierung

Bitte verifizieren Sie Ihre E-Mail-Adresse unter:
{{verificationUrl}}

{{#if expirationTime}}Dieser Link läuft in {{expirationTime}} ab.{{/if}}

Wenn Sie diese E-Mail nicht angefordert haben, ignorieren Sie sie bitte.

© {{currentYear}} {{tenantClientName}}`,
      notification_subtype_id: subtypeIds['email-verification']
    },
    {
      name: 'password-reset',
      language_code: 'de',
      subject: 'Passwort-Zurücksetzungsanfrage',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Passwort zurücksetzen</h2>
          <p>Hallo {{userName}},</p>
          <p>Sie haben angefordert, Ihr Passwort für {{email}} zurückzusetzen. Klicken Sie auf den untenstehenden Link, um fortzufahren:</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Passwort zurücksetzen</a></p>
          <p>Oder kopieren Sie diesen Link in Ihren Browser:</p>
          <p>{{resetLink}}</p>
          <p><small>Dieser Link läuft in {{expirationTime}} ab.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Wenn Sie diese Zurücksetzung nicht angefordert haben, ignorieren Sie diese E-Mail bitte. Ihr Passwort bleibt unverändert.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">Benötigen Sie Hilfe? Kontaktieren Sie {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Passwort-Zurücksetzungsanfrage

Hallo {{userName}},

Sie haben angefordert, Ihr Passwort für {{email}} zurückzusetzen. Besuchen Sie folgenden Link:
{{resetLink}}

Dieser Link läuft in {{expirationTime}} ab.

Wenn Sie diese Zurücksetzung nicht angefordert haben, ignorieren Sie diese E-Mail bitte.
{{#if supportEmail}}Benötigen Sie Hilfe? Kontaktieren Sie {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`,
      notification_subtype_id: subtypeIds['password-reset']
    },
    {
      name: 'portal-invitation',
      language_code: 'de',
      subject: 'Kundenportal-Einladung - {{clientName}}',
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portalzugangs-Einladung</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .header {
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 32px 24px;
      border-radius: 12px 12px 0 0;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      opacity: 1;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.95);
    }
    .content {
      background: #ffffff;
      padding: 32px;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-bottom: none;
    }
    .footer {
      background: #1e293b;
      color: #cbd5e1;
      padding: 24px;
      border-radius: 0 0 12px 12px;
      text-align: center;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: #cbd5e1;
    }
    .footer p:last-child {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 16px;
    }
    .info-box {
      background: #faf8ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e9e5f5;
      border-left: 4px solid #8a4dea;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .info-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .info-box p {
      margin: 8px 0;
      color: #334155;
    }
    .action-button {
      display: inline-block;
      background: #8a4dea;
      color: #ffffff !important;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 24px 0;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 16px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .action-button:hover {
      background: #7c3aed;
      color: #ffffff !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .warning h4 {
      color: #92400e;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning p {
      margin: 0;
      color: #92400e;
    }
    .contact-info {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    .contact-info h4 {
      color: #0f172a;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .contact-info p {
      margin: 4px 0;
      color: #334155;
      font-size: 14px;
    }
    h2 {
      color: #0f172a;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: #334155;
      margin: 0 0 16px 0;
    }
    a {
      color: #8a4dea;
      text-decoration: underline;
    }
    a:hover {
      color: #7c3aed;
    }
    .tagline {
      background: #faf8ff;
      border-left: 3px solid #8a4dea;
      padding: 20px 24px;
      margin: 24px 0;
      font-style: normal;
      color: #334155;
      border-radius: 6px;
      line-height: 1.7;
    }
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: #64748b;
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Willkommen in Ihrem Kundenportal</h1>
    <p>Sie sind eingeladen, auf Ihr Konto zuzugreifen</p>
  </div>

  <div class="content">
    <h2>Hallo {{contactName}},</h2>

    <p>Großartige Neuigkeiten! Sie wurden eingeladen, auf das Kundenportal von <strong>{{clientName}}</strong> zuzugreifen. Dieses sichere Portal bietet Ihnen sofortigen Zugang zu:</p>

    <div class="info-box">
      <h3>🎯 Worauf Sie zugreifen können</h3>
      <p>✓ Ihre Support-Tickets anzeigen und verfolgen</p>
      <p>✓ Projekt-Updates und Dokumentation einsehen</p>
      <p>✓ Direkt mit Ihrem Support-Team kommunizieren</p>
    </div>

    <div class="tagline">
      Erleben Sie nahtloses Service-Management mit unserem intuitiven Portal. Alles, was Sie brauchen, um informiert und verbunden zu bleiben, an einem sicheren Ort.
    </div>

    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">Meinen Portalzugang einrichten</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Oder kopieren Sie diesen Link in Ihren Browser:
    </p>
    <div class="link-text">{{portalLink}}</div>

    <div class="warning">
      <h4>⏰ Zeitlich begrenzte Einladung</h4>
      <p>Dieser Einladungslink läuft in <strong>{{expirationTime}}</strong> ab. Bitte schließen Sie die Einrichtung Ihres Kontos vorher ab, um einen unterbrechungsfreien Zugang zu gewährleisten.</p>
    </div>

    <div class="divider"></div>

    <div class="contact-info">
      <h4>Benötigen Sie Unterstützung?</h4>
      <p><strong>E-Mail:</strong> {{clientLocationEmail}}</p>
      <p><strong>Telefon:</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Unser Support-Team ist bereit, Ihnen beim Einstieg zu helfen.</p>
    </div>
  </div>

  <div class="footer">
    <p>Diese E-Mail wurde an {{contactName}} im Rahmen der Einrichtung Ihres Portalzugangs gesendet.</p>
    <p>Wenn Sie diese Einladung nicht erwartet haben, kontaktieren Sie uns bitte unter {{clientLocationEmail}}.</p>
    <p>© {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.</p>
  </div>
</body>
</html>`,
      text_content: `Willkommen in Ihrem Kundenportal

Hallo {{contactName}},

Großartige Neuigkeiten! Sie wurden eingeladen, auf das Kundenportal von {{clientName}} zuzugreifen. Dieses sichere Portal bietet Ihnen sofortigen Zugang zu:

✓ Ihre Support-Tickets anzeigen und verfolgen
✓ Projekt-Updates und Dokumentation einsehen
✓ Direkt mit Ihrem Support-Team kommunizieren

MEINEN PORTALZUGANG EINRICHTEN:
{{portalLink}}

⏰ ZEITLICH BEGRENZT: Dieser Einladungslink läuft in {{expirationTime}} ab. Bitte schließen Sie die Einrichtung Ihres Kontos vorher ab, um einen unterbrechungsfreien Zugang zu gewährleisten.

BENÖTIGEN SIE UNTERSTÜTZUNG?
E-Mail: {{clientLocationEmail}}
Telefon: {{clientLocationPhone}}

Unser Support-Team ist bereit, Ihnen beim Einstieg zu helfen.

---
Diese E-Mail wurde an {{contactName}} im Rahmen der Einrichtung Ihres Portalzugangs gesendet.
Wenn Sie diese Einladung nicht erwartet haben, kontaktieren Sie uns bitte unter {{clientLocationEmail}}.

© {{currentYear}} {{clientName}}. Alle Rechte vorbehalten.
`,
      notification_subtype_id: subtypeIds['portal-invitation']
    },
    {
      name: 'tenant-recovery',
      language_code: 'de',
      subject: '{{platformName}} - Ihre Anmeldelinks',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Sie haben Zugang zu Ihrem Kundenportal{{#if isMultiple}} angefordert{{else}} angefordert{{/if}}.
              {{#if isMultiple}}Wir haben {{tenantCount}} Organisationen gefunden, die mit Ihrer E-Mail-Adresse verknüpft sind.{{else}}Hier ist Ihr Anmeldelink:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Sicherheitshinweis:</strong> Wenn Sie diese Anmeldelinks nicht angefordert haben, können Sie diese E-Mail sicher ignorieren. Ihr Konto bleibt sicher.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Bei Fragen oder für Unterstützung wenden Sie sich bitte an das Support-Team Ihrer Organisation.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Ihre Anmeldelinks

Hallo,

Sie haben Zugang zu Ihrem Kundenportal{{#if isMultiple}} angefordert{{else}} angefordert{{/if}}.
{{#if isMultiple}}Wir haben {{tenantCount}} Organisationen gefunden, die mit Ihrer E-Mail-Adresse verknüpft sind.{{else}}Hier ist Ihr Anmeldelink:{{/if}}

Ihre Anmeldelinks:
{{tenantLinksText}}

Sicherheitshinweis: Wenn Sie diese Anmeldelinks nicht angefordert haben, können Sie diese E-Mail sicher ignorieren.

Bei Fragen oder für Unterstützung wenden Sie sich bitte an das Support-Team Ihrer Organisation.

---
© {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.`,
      notification_subtype_id: subtypeIds['tenant-recovery']
    },
    {
      name: 'no-account-found',
      language_code: 'de',
      subject: '{{platformName}} - Zugriffsanfrage',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              Wir haben eine Anfrage für den Zugriff auf das Kundenportal mit dieser E-Mail-Adresse erhalten.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Wenn Sie ein Konto bei uns haben, sollten Sie eine separate E-Mail mit Ihren Anmeldelinks erhalten haben.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Wenn Sie keine Anmelde-E-Mail erhalten haben, könnte dies bedeuten:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Diese E-Mail-Adresse ist mit keinem Kundenportal-Konto verknüpft</li>
              <li>Ihr Konto könnte inaktiv sein</li>
              <li>Die E-Mail könnte in Ihrem Spam-Ordner gefiltert worden sein</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Benötigen Sie Hilfe?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Wenn Sie glauben, dass Sie Zugang zu einem Kundenportal haben sollten, wenden Sie sich bitte an das Support-Team Ihres Dienstleisters.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Sicherheitshinweis:</strong> Wenn Sie keinen Zugriff angefordert haben, können Sie diese E-Mail sicher ignorieren.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Zugriffsanfrage

Hallo,

Wir haben eine Anfrage für den Zugriff auf das Kundenportal mit dieser E-Mail-Adresse erhalten.

Wenn Sie ein Konto bei uns haben, sollten Sie eine separate E-Mail mit Ihren Anmeldelinks erhalten haben.

Wenn Sie keine Anmelde-E-Mail erhalten haben, könnte dies bedeuten:
- Diese E-Mail-Adresse ist mit keinem Kundenportal-Konto verknüpft
- Ihr Konto könnte inaktiv sein
- Die E-Mail könnte in Ihrem Spam-Ordner gefiltert worden sein

Benötigen Sie Hilfe?
Wenn Sie glauben, dass Sie Zugang zu einem Kundenportal haben sollten, wenden Sie sich bitte an das Support-Team Ihres Dienstleisters.

Sicherheitshinweis: Wenn Sie keinen Zugriff angefordert haben, können Sie diese E-Mail sicher ignorieren.

---
© {{currentYear}} {{platformName}}. Alle Rechte vorbehalten.
Dies ist eine automatisierte Nachricht. Bitte antworten Sie nicht auf diese E-Mail.`,
      notification_subtype_id: subtypeIds['no-account-found']
    }
  ]).onConflict(['name', 'language_code']).ignore();

  console.log('✓ German system auth templates added');

  // Dutch templates
  await knex('system_email_templates').insert([
    {
      name: 'email-verification',
      language_code: 'nl',
      subject: 'Verifieer uw e-mailadres{{#if registrationClientName}} voor {{registrationClientName}}{{/if}}',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>E-mailverificatie</h2>
          <p>Hallo,</p>
          <p>Verifieer uw e-mailadres door op onderstaande link te klikken:</p>
          <p><a href="{{verificationUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">E-mail verifiëren</a></p>
          <p>Of kopieer deze link naar uw browser:</p>
          <p>{{verificationUrl}}</p>
          {{#if expirationTime}}
          <p><small>Deze link verloopt over {{expirationTime}}.</small></p>
          {{/if}}
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Als u deze e-mail niet heeft aangevraagd, kunt u deze negeren.</p>
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{tenantClientName}}</p>
        </div>
      `,
      text_content: `E-mailverificatie

Verifieer uw e-mailadres door naar deze link te gaan:
{{verificationUrl}}

{{#if expirationTime}}Deze link verloopt over {{expirationTime}}.{{/if}}

Als u deze e-mail niet heeft aangevraagd, kunt u deze negeren.

© {{currentYear}} {{tenantClientName}}`,
      notification_subtype_id: subtypeIds['email-verification']
    },
    {
      name: 'password-reset',
      language_code: 'nl',
      subject: 'Verzoek tot wachtwoordherstel',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Wachtwoord opnieuw instellen</h2>
          <p>Hallo {{userName}},</p>
          <p>U heeft verzocht om uw wachtwoord voor {{email}} opnieuw in te stellen. Klik op onderstaande link om door te gaan:</p>
          <p><a href="{{resetLink}}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Wachtwoord opnieuw instellen</a></p>
          <p>Of kopieer deze link naar uw browser:</p>
          <p>{{resetLink}}</p>
          <p><small>Deze link verloopt over {{expirationTime}}.</small></p>
          <hr style="margin-top: 30px;">
          <p style="color: #666; font-size: 12px;">Als u dit wachtwoordherstel niet heeft aangevraagd, kunt u deze e-mail negeren. Uw wachtwoord blijft ongewijzigd.</p>
          {{#if supportEmail}}
          <p style="color: #666; font-size: 12px;">Hulp nodig? Neem contact op met {{supportEmail}}</p>
          {{/if}}
          <p style="color: #999; font-size: 11px;">© {{currentYear}} {{clientName}}</p>
        </div>
      `,
      text_content: `Verzoek tot wachtwoordherstel

Hallo {{userName}},

U heeft verzocht om uw wachtwoord voor {{email}} opnieuw in te stellen. Bezoek de volgende link:
{{resetLink}}

Deze link verloopt over {{expirationTime}}.

Als u dit wachtwoordherstel niet heeft aangevraagd, kunt u deze e-mail negeren.
{{#if supportEmail}}Hulp nodig? Neem contact op met {{supportEmail}}{{/if}}

© {{currentYear}} {{clientName}}`,
      notification_subtype_id: subtypeIds['password-reset']
    },
    {
      name: 'portal-invitation',
      language_code: 'nl',
      subject: 'Uitnodiging voor klantenportaal - {{clientName}}',
      html_content: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portaaltoegang uitnodiging</title>
  <style>
    body {
      font-family: Inter, system-ui, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8fafc;
    }
    .header {
      background: linear-gradient(135deg, #8a4dea 0%, #7c3aed 100%);
      color: white;
      padding: 32px 24px;
      border-radius: 12px 12px 0 0;
      text-align: center;
    }
    .header h1 {
      font-family: Poppins, system-ui, sans-serif;
      font-weight: 700;
      font-size: 28px;
      margin: 0 0 8px 0;
      color: white;
    }
    .header p {
      margin: 0;
      opacity: 1;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.95);
    }
    .content {
      background: #ffffff;
      padding: 32px;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-bottom: none;
    }
    .footer {
      background: #1e293b;
      color: #cbd5e1;
      padding: 24px;
      border-radius: 0 0 12px 12px;
      text-align: center;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: #cbd5e1;
    }
    .footer p:last-child {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 16px;
    }
    .info-box {
      background: #faf8ff;
      padding: 24px;
      border-radius: 8px;
      border: 1px solid #e9e5f5;
      border-left: 4px solid #8a4dea;
      margin: 24px 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .info-box h3 {
      color: #0f172a;
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .info-box p {
      margin: 8px 0;
      color: #334155;
    }
    .action-button {
      display: inline-block;
      background: #8a4dea;
      color: #ffffff !important;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 24px 0;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 16px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .action-button:hover {
      background: #7c3aed;
      color: #ffffff !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning {
      background: #fffbeb;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .warning h4 {
      color: #92400e;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning p {
      margin: 0;
      color: #92400e;
    }
    .contact-info {
      background: #f8fafc;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    .contact-info h4 {
      color: #0f172a;
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .contact-info p {
      margin: 4px 0;
      color: #334155;
      font-size: 14px;
    }
    h2 {
      color: #0f172a;
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: #334155;
      margin: 0 0 16px 0;
    }
    a {
      color: #8a4dea;
      text-decoration: underline;
    }
    a:hover {
      color: #7c3aed;
    }
    .tagline {
      background: #faf8ff;
      border-left: 3px solid #8a4dea;
      padding: 20px 24px;
      margin: 24px 0;
      font-style: normal;
      color: #334155;
      border-radius: 6px;
      line-height: 1.7;
    }
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: #64748b;
      background: #f8fafc;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Welkom bij uw klantenportaal</h1>
    <p>U bent uitgenodigd om toegang te krijgen tot uw account</p>
  </div>

  <div class="content">
    <h2>Hallo {{contactName}},</h2>

    <p>Geweldig nieuws! U bent uitgenodigd om toegang te krijgen tot het klantenportaal van <strong>{{clientName}}</strong>. Dit beveiligde portaal geeft u directe toegang tot:</p>

    <div class="info-box">
      <h3>🎯 Waartoe u toegang heeft</h3>
      <p>✓ Uw supporttickets bekijken en volgen</p>
      <p>✓ Projectupdates en documentatie bekijken</p>
      <p>✓ Rechtstreeks communiceren met uw supportteam</p>
    </div>

    <div class="tagline">
      Ervaar naadloos servicebeheer met ons intuïtieve portaal. Alles wat u nodig heeft om geïnformeerd en verbonden te blijven, allemaal op één veilige locatie.
    </div>

    <div style="text-align: center;">
      <a href="{{portalLink}}" class="action-button">Mijn portaaltoegang instellen</a>
    </div>

    <p style="text-align: center; color: #64748b; font-size: 14px;">
      Of kopieer en plak deze link in uw browser:
    </p>
    <div class="link-text">{{portalLink}}</div>

    <div class="warning">
      <h4>⏰ Tijdgevoelige uitnodiging</h4>
      <p>Deze uitnodigingslink verloopt over <strong>{{expirationTime}}</strong>. Voltooi uw accountinstelling voor die tijd om ononderbroken toegang te garanderen.</p>
    </div>

    <div class="divider"></div>

    <div class="contact-info">
      <h4>Hulp nodig?</h4>
      <p><strong>E-mail:</strong> {{clientLocationEmail}}</p>
      <p><strong>Telefoon:</strong> {{clientLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Ons supportteam staat klaar om u te helpen aan de slag te gaan.</p>
    </div>
  </div>

  <div class="footer">
    <p>Deze e-mail is verzonden naar {{contactName}} als onderdeel van uw portaaltoegang instelling.</p>
    <p>Als u deze uitnodiging niet verwachtte, neem dan contact met ons op via {{clientLocationEmail}}.</p>
    <p>© {{currentYear}} {{clientName}}. Alle rechten voorbehouden.</p>
  </div>
</body>
</html>`,
      text_content: `Welkom bij uw klantenportaal

Hallo {{contactName}},

Geweldig nieuws! U bent uitgenodigd om toegang te krijgen tot het klantenportaal van {{clientName}}. Dit beveiligde portaal geeft u directe toegang tot:

✓ Uw supporttickets bekijken en volgen
✓ Projectupdates en documentatie bekijken
✓ Rechtstreeks communiceren met uw supportteam

MIJN PORTAALTOEGANG INSTELLEN:
{{portalLink}}

⏰ TIJDGEVOELIG: Deze uitnodigingslink verloopt over {{expirationTime}}. Voltooi uw accountinstelling voor die tijd om ononderbroken toegang te garanderen.

HULP NODIG?
E-mail: {{clientLocationEmail}}
Telefoon: {{clientLocationPhone}}

Ons supportteam staat klaar om u te helpen aan de slag te gaan.

---
Deze e-mail is verzonden naar {{contactName}} als onderdeel van uw portaaltoegang instelling.
Als u deze uitnodiging niet verwachtte, neem dan contact met ons op via {{clientLocationEmail}}.

© {{currentYear}} {{clientName}}. Alle rechten voorbehouden.
`,
      notification_subtype_id: subtypeIds['portal-invitation']
    },
    {
      name: 'tenant-recovery',
      language_code: 'nl',
      subject: '{{platformName}} - Uw inloglinks',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              U heeft toegang aangevraagd tot uw klantenpor{{#if isMultiple}}talen{{else}}taal{{/if}}.
              {{#if isMultiple}}We hebben {{tenantCount}} organisaties gevonden die gekoppeld zijn aan uw e-mailadres.{{else}}Hier is uw inloglink:{{/if}}
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 25px 0;">
              {{tenantLinksHtml}}
            </table>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Beveiligingsopmerking:</strong> Als u deze inloglinks niet heeft aangevraagd, kunt u deze e-mail veilig negeren. Uw account blijft beveiligd.
              </p>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              <p style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">
                Als u vragen heeft of hulp nodig heeft, neem dan contact op met het ondersteuningsteam van uw organisatie.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Uw inloglinks

Hallo,

U heeft toegang aangevraagd tot uw klantenpor{{#if isMultiple}}talen{{else}}taal{{/if}}.
{{#if isMultiple}}We hebben {{tenantCount}} organisaties gevonden die gekoppeld zijn aan uw e-mailadres.{{else}}Hier is uw inloglink:{{/if}}

Uw inloglinks:
{{tenantLinksText}}

Beveiligingsopmerking: Als u deze inloglinks niet heeft aangevraagd, kunt u deze e-mail veilig negeren.

Als u vragen heeft of hulp nodig heeft, neem dan contact op met het ondersteuningsteam van uw organisatie.

---
© {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.`,
      notification_subtype_id: subtypeIds['tenant-recovery']
    },
    {
      name: 'no-account-found',
      language_code: 'nl',
      subject: '{{platformName}} - Toegangsverzoek',
      html_content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; margin: 0;">
            {{platformName}}
          </h2>
          <div style="padding: 40px 30px;">
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">Hallo,</p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 20px;">
              We hebben een verzoek ontvangen voor toegang tot het klantenportaal met dit e-mailadres.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 15px;">
              Als u een account bij ons heeft, zou u een aparte e-mail moeten hebben ontvangen met uw inloglinks.
            </p>
            <p style="color: #111827; font-size: 16px; margin-bottom: 10px;">
              Als u geen inlog-e-mail heeft ontvangen, kan dit betekenen:
            </p>
            <ul style="color: #111827; font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
              <li>Dit e-mailadres is niet gekoppeld aan een klantenportalaccount</li>
              <li>Uw account kan inactief zijn</li>
              <li>De e-mail kan zijn gefilterd naar uw spam-map</li>
            </ul>

            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 25px 0;">
              <p style="color: #1e40af; font-size: 14px; margin: 0;">
                <strong>Hulp nodig?</strong>
              </p>
              <p style="color: #1e40af; font-size: 14px; margin: 5px 0 0 0;">
                Als u denkt dat u toegang zou moeten hebben tot een klantenportaal, neem dan contact op met het ondersteuningsteam van uw serviceprovider voor hulp.
              </p>
            </div>

            <div style="background-color: #f3f4f6; border-radius: 6px; padding: 20px; margin: 25px 0;">
              <p style="color: #4b5563; font-size: 14px; margin: 0;">
                <strong>Beveiligingsopmerking:</strong> Als u geen toegang heeft aangevraagd, kunt u deze e-mail veilig negeren.
              </p>
            </div>
          </div>

          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0;">
              © {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
            </p>
            <p style="color: #9ca3af; font-size: 11px; margin: 5px 0;">
              Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.
            </p>
          </div>
        </div>
      `,
      text_content: `{{platformName}} - Toegangsverzoek

Hallo,

We hebben een verzoek ontvangen voor toegang tot het klantenportaal met dit e-mailadres.

Als u een account bij ons heeft, zou u een aparte e-mail moeten hebben ontvangen met uw inloglinks.

Als u geen inlog-e-mail heeft ontvangen, kan dit betekenen:
- Dit e-mailadres is niet gekoppeld aan een klantenportalaccount
- Uw account kan inactief zijn
- De e-mail kan zijn gefilterd naar uw spam-map

Hulp nodig?
Als u denkt dat u toegang zou moeten hebben tot een klantenportaal, neem dan contact op met het ondersteuningsteam van uw serviceprovider voor hulp.

Beveiligingsopmerking: Als u geen toegang heeft aangevraagd, kunt u deze e-mail veilig negeren.

---
© {{currentYear}} {{platformName}}. Alle rechten voorbehouden.
Dit is een geautomatiseerd bericht. Reageer alstublieft niet op deze e-mail.`,
      notification_subtype_id: subtypeIds['no-account-found']
    }
  ]).onConflict(['name', 'language_code']).ignore();

  console.log('✓ Dutch system auth templates added');

  console.log('System authentication email templates migration complete!');
};

exports.down = async function(knex) {
  // Remove system auth templates (including tenant-recovery)
  await knex('system_email_templates')
    .whereIn('name', ['email-verification', 'password-reset', 'portal-invitation', 'tenant-recovery', 'no-account-found'])
    .del();

  console.log('System authentication email templates removed (including tenant-recovery)');
};
