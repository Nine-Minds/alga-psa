/**
 * Fix portal invitation email template variable names
 *
 * The email sending code passes clientName, clientLocationEmail, and clientLocationPhone
 * but the template was using the old company* variable names, causing these fields
 * to not be replaced in the sent emails.
 *
 * This migration updates the template to use the correct client* variable names.
 */

exports.up = async function(knex) {
  const portalInvitationHtml = `
<!DOCTYPE html>
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
</html>`;

  const portalInvitationText = `
Welcome to Your Customer Portal

Hello {{contactName}},

Great news! You've been invited to access the customer portal for {{clientName}}. This secure portal gives you instant access to:

✓ View and track your support tickets
✓ Review project updates and documentation
✓ Communicate directly with your support team

SET UP YOUR PORTAL ACCESS:
{{portalLink}}

⏰ TIME-SENSITIVE: This invitation link will expire in {{expirationTime}}. Please complete your account setup before then to ensure uninterrupted access.

NEED ASSISTANCE?
Email: {{clientLocationEmail}}
Phone: {{clientLocationPhone}}

Our support team is ready to help you get started.

---
This email was sent to {{contactName}} as part of your portal access setup.
If you didn't expect this invitation, please contact us at {{clientLocationEmail}}.

© {{currentYear}} {{clientName}}. All rights reserved.
`;

  // Update portal-invitation template with corrected variable names
  await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .update({
      html_content: portalInvitationHtml,
      text_content: portalInvitationText,
      updated_at: new Date()
    });
};

exports.down = async function(knex) {
  // Revert to the previous version with company* variable names
  const previousPortalInvitationHtml = `
<!DOCTYPE html>
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

    <p>Great news! You've been invited to access the customer portal for <strong>{{companyName}}</strong>. This secure portal gives you instant access to:</p>

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
      <p><strong>Email:</strong> {{companyLocationEmail}}</p>
      <p><strong>Phone:</strong> {{companyLocationPhone}}</p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">Our support team is ready to help you get started.</p>
    </div>
  </div>

  <div class="footer">
    <p>This email was sent to {{contactName}} as part of your portal access setup.</p>
    <p>If you didn't expect this invitation, please contact us at {{companyLocationEmail}}.</p>
    <p>© {{currentYear}} {{companyName}}. All rights reserved.</p>
  </div>
</body>
</html>`;

  const previousPortalInvitationText = `
Welcome to Your Customer Portal

Hello {{contactName}},

Great news! You've been invited to access the customer portal for {{companyName}}. This secure portal gives you instant access to:

✓ View and track your support tickets
✓ Review project updates and documentation
✓ Communicate directly with your support team

SET UP YOUR PORTAL ACCESS:
{{portalLink}}

⏰ TIME-SENSITIVE: This invitation link will expire in {{expirationTime}}. Please complete your account setup before then to ensure uninterrupted access.

NEED ASSISTANCE?
Email: {{companyLocationEmail}}
Phone: {{companyLocationPhone}}

Our support team is ready to help you get started.

---
This email was sent to {{contactName}} as part of your portal access setup.
If you didn't expect this invitation, please contact us at {{companyLocationEmail}}.

© {{currentYear}} {{companyName}}. All rights reserved.
`;

  await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .update({
      html_content: previousPortalInvitationHtml,
      text_content: previousPortalInvitationText,
      updated_at: new Date()
    });
};
