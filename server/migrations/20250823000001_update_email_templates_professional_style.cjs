/**
 * Update email templates with professional styling matching account creation confirmation
 */

// Email template color scheme - matching the account creation template
const COLORS = {
  // Brand colors
  primary: '#8a4dea',
  primaryDark: '#7c3aed',
  primaryLight: '#a366f0',
  primarySubtle: '#faf8ff',
  primaryAccent: '#f3f0ff',
  
  // Neutral colors
  textPrimary: '#0f172a',
  textSecondary: '#334155',
  textMuted: '#64748b',
  textLight: '#94a3b8',
  textOnDark: '#cbd5e1',
  
  // Background colors
  bgPrimary: '#ffffff',
  bgSecondary: '#f8fafc',
  bgDark: '#1e293b',
  
  // Border colors
  borderLight: '#e2e8f0',
  borderSubtle: '#e9e5f5',
  
  // State colors
  warning: '#f59e0b',
  warningBg: '#fffbeb',
  warningText: '#92400e',
  success: '#10b981',
  successBg: '#f0fdf4',
  successText: '#166534',
};

exports.up = async function(knex) {
  // Update portal-invitation template
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
      color: ${COLORS.textPrimary}; 
      max-width: 600px; 
      margin: 0 auto; 
      padding: 20px; 
      background-color: ${COLORS.bgSecondary}; 
    }
    .header { 
      background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%); 
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
      background: ${COLORS.bgPrimary}; 
      padding: 32px; 
      border: 1px solid ${COLORS.borderLight}; 
      border-top: none; 
      border-bottom: none; 
    }
    .footer { 
      background: ${COLORS.bgDark}; 
      color: ${COLORS.textOnDark}; 
      padding: 24px; 
      border-radius: 0 0 12px 12px; 
      text-align: center; 
      font-size: 14px; 
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: ${COLORS.textOnDark};
    }
    .footer p:last-child {
      color: ${COLORS.textLight};
      font-size: 13px;
      margin-top: 16px;
    }
    .info-box { 
      background: ${COLORS.primarySubtle}; 
      padding: 24px; 
      border-radius: 8px; 
      border: 1px solid ${COLORS.borderSubtle};
      border-left: 4px solid ${COLORS.primary};
      margin: 24px 0; 
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .info-box h3 {
      color: ${COLORS.textPrimary};
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .info-box p {
      margin: 8px 0;
      color: ${COLORS.textSecondary};
    }
    .action-button { 
      display: inline-block; 
      background: ${COLORS.primary}; 
      color: ${COLORS.bgPrimary} !important; 
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
      background: ${COLORS.primaryDark};
      color: ${COLORS.bgPrimary} !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning { 
      background: ${COLORS.warningBg}; 
      border: 1px solid ${COLORS.warning}; 
      border-radius: 8px; 
      padding: 20px; 
      margin: 24px 0; 
    }
    .warning h4 {
      color: ${COLORS.warningText};
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning p {
      margin: 0;
      color: ${COLORS.warningText};
    }
    .contact-info {
      background: ${COLORS.bgSecondary};
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid ${COLORS.borderLight};
    }
    .contact-info h4 {
      color: ${COLORS.textPrimary};
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .contact-info p {
      margin: 4px 0;
      color: ${COLORS.textSecondary};
      font-size: 14px;
    }
    h2 {
      color: ${COLORS.textPrimary};
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: ${COLORS.textSecondary};
      margin: 0 0 16px 0;
    }
    a {
      color: ${COLORS.primary};
      text-decoration: underline;
    }
    a:hover {
      color: ${COLORS.primaryDark};
    }
    .tagline {
      background: ${COLORS.primarySubtle};
      border-left: 3px solid ${COLORS.primary};
      padding: 20px 24px;
      margin: 24px 0;
      font-style: normal;
      color: ${COLORS.textSecondary};
      border-radius: 6px;
      line-height: 1.7;
    }
    .divider {
      height: 1px;
      background: ${COLORS.borderLight};
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: ${COLORS.textMuted};
      background: ${COLORS.bgSecondary};
      padding: 12px;
      border-radius: 6px;
      border: 1px solid ${COLORS.borderLight};
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
    
    <p style="text-align: center; color: ${COLORS.textMuted}; font-size: 14px;">
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
      <p style="margin-top: 12px; font-size: 13px; color: ${COLORS.textMuted};">Our support team is ready to help you get started.</p>
    </div>
  </div>

  <div class="footer">
    <p>This email was sent to {{contactName}} as part of your portal access setup.</p>
    <p>If you didn't expect this invitation, please contact us at {{companyLocationEmail}}.</p>
    <p>© {{currentYear}} {{companyName}}. All rights reserved.</p>
  </div>
</body>
</html>`;

  const portalInvitationText = `
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

  // Update password-reset template
  const passwordResetHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Request</title>
  <style>
    body { 
      font-family: Inter, system-ui, sans-serif; 
      line-height: 1.6; 
      color: ${COLORS.textPrimary}; 
      max-width: 600px; 
      margin: 0 auto; 
      padding: 20px; 
      background-color: ${COLORS.bgSecondary}; 
    }
    .header { 
      background: linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%); 
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
      background: ${COLORS.bgPrimary}; 
      padding: 32px; 
      border: 1px solid ${COLORS.borderLight}; 
      border-top: none; 
      border-bottom: none; 
    }
    .footer { 
      background: ${COLORS.bgDark}; 
      color: ${COLORS.textOnDark}; 
      padding: 24px; 
      border-radius: 0 0 12px 12px; 
      text-align: center; 
      font-size: 14px; 
      line-height: 1.6;
    }
    .footer p {
      margin: 6px 0;
      color: ${COLORS.textOnDark};
    }
    .footer p:last-child {
      color: ${COLORS.textLight};
      font-size: 13px;
      margin-top: 16px;
    }
    .security-box { 
      background: ${COLORS.primarySubtle}; 
      padding: 24px; 
      border-radius: 8px; 
      border: 1px solid ${COLORS.borderSubtle};
      border-left: 4px solid ${COLORS.primary};
      margin: 24px 0; 
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .security-box h3 {
      color: ${COLORS.textPrimary};
      margin: 0 0 16px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .security-box p {
      margin: 8px 0;
      color: ${COLORS.textSecondary};
    }
    .action-button { 
      display: inline-block; 
      background: ${COLORS.primary}; 
      color: ${COLORS.bgPrimary} !important; 
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
      background: ${COLORS.primaryDark};
      color: ${COLORS.bgPrimary} !important;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      transform: translateY(-1px);
    }
    .warning { 
      background: ${COLORS.warningBg}; 
      border: 1px solid ${COLORS.warning}; 
      border-radius: 8px; 
      padding: 20px; 
      margin: 24px 0; 
    }
    .warning h4 {
      color: ${COLORS.warningText};
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .warning ul {
      margin: 0;
      padding-left: 20px;
      color: ${COLORS.warningText};
    }
    .warning li {
      margin: 4px 0;
    }
    h2 {
      color: ${COLORS.textPrimary};
      font-family: Poppins, system-ui, sans-serif;
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px 0;
    }
    p {
      color: ${COLORS.textSecondary};
      margin: 0 0 16px 0;
    }
    a {
      color: ${COLORS.primary};
      text-decoration: underline;
    }
    a:hover {
      color: ${COLORS.primaryDark};
    }
    .code { 
      font-family: 'Courier New', monospace; 
      background: ${COLORS.borderLight}; 
      padding: 4px 8px; 
      border-radius: 4px; 
      color: ${COLORS.textPrimary}; 
      font-size: 14px;
      font-weight: 600;
    }
    .divider {
      height: 1px;
      background: ${COLORS.borderLight};
      margin: 32px 0;
    }
    .link-text {
      word-break: break-all;
      font-size: 14px;
      color: ${COLORS.textMuted};
      background: ${COLORS.bgSecondary};
      padding: 12px;
      border-radius: 6px;
      border: 1px solid ${COLORS.borderLight};
      margin: 12px 0;
    }
    .help-section {
      background: ${COLORS.bgSecondary};
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
      border: 1px solid ${COLORS.borderLight};
    }
    .help-section h4 {
      color: ${COLORS.textPrimary};
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
    .help-section p {
      margin: 4px 0;
      color: ${COLORS.textSecondary};
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Password Reset Request</h1>
    <p>Secure password recovery for your account</p>
  </div>

  <div class="content">
    <h2>Hello {{userName}},</h2>
    
    <p>We received a request to reset the password for your account associated with <strong>{{email}}</strong>.</p>
    
    <div class="security-box">
      <h3>🔐 Account Security Check</h3>
      <p><strong>Requested at:</strong> Just now</p>
      <p><strong>Account email:</strong> {{email}}</p>
      <p><strong>Valid for:</strong> {{expirationTime}}</p>
    </div>
    
    <p>To create a new password for your account, click the button below:</p>
    
    <div style="text-align: center;">
      <a href="{{resetLink}}" class="action-button">Reset Your Password</a>
    </div>
    
    <p style="text-align: center; color: ${COLORS.textMuted}; font-size: 14px;">
      Or copy and paste this link into your browser:
    </p>
    <div class="link-text">{{resetLink}}</div>
    
    <div class="warning">
      <h4>⚠️ Important Security Information</h4>
      <ul>
        <li>This password reset link will expire in <strong>{{expirationTime}}</strong></li>
        <li>For security reasons, this link can only be used <strong>once</strong></li>
        <li>If you didn't request this reset, please ignore this email</li>
        <li>Your password won't change until you create a new one</li>
      </ul>
    </div>
    
    <h3>What's Next?</h3>
    <ol>
      <li>Click the reset button above or use the provided link</li>
      <li>Create a strong, unique password for your account</li>
      <li>You'll be automatically logged in after resetting</li>
      <li>All existing sessions will be terminated for security</li>
      <li>Consider enabling two-factor authentication for added protection</li>
    </ol>
    
    <div class="divider"></div>
    
    <div class="help-section">
      <h4>Need Help?</h4>
      <p>If you're having trouble resetting your password, our support team is here to help.</p>
      <p style="margin-top: 12px;"><strong>Contact Support:</strong> {{supportEmail}}</p>
    </div>
  </div>

  <div class="footer">
    <p>This is an automated security email sent to {{email}}.</p>
    <p>For your security, we never include passwords in emails.</p>
    <p>© {{currentYear}} {{clientName}}. All rights reserved.</p>
  </div>
</body>
</html>`;

  const passwordResetText = `
Password Reset Request

Hello {{userName}},

We received a request to reset the password for your account associated with {{email}}.

ACCOUNT SECURITY CHECK:
• Account email: {{email}}
• Valid for: {{expirationTime}}

RESET YOUR PASSWORD:
Click the link below to create a new password for your account:
{{resetLink}}

⚠️ IMPORTANT SECURITY INFORMATION:
• This password reset link will expire in {{expirationTime}}
• For security reasons, this link can only be used once
• If you didn't request this reset, please ignore this email
• Your password won't change until you create a new one

✅ AFTER RESETTING YOUR PASSWORD:
• You'll be automatically logged in to your account
• All your existing sessions will be terminated for security
• Consider enabling two-factor authentication for added security

NEED HELP?
If you're having trouble resetting your password, our support team is here to help.
Contact Support: {{supportEmail}}

---
This is an automated security email sent to {{email}}.
For your security, we never include passwords in emails.

© {{currentYear}} {{clientName}}. All rights reserved.
`;

  // Update portal-invitation template
  await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .update({
      html_content: portalInvitationHtml,
      text_content: portalInvitationText,
      updated_at: new Date()
    });

  // Update password-reset template
  await knex('system_email_templates')
    .where({ name: 'password-reset' })
    .update({
      html_content: passwordResetHtml,
      text_content: passwordResetText,
      updated_at: new Date()
    });
};

exports.down = async function(knex) {
  // Revert portal-invitation to previous version
  const previousPortalInvitationHtml = `
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
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="color: #495057; margin: 0 0 10px 0; font-size: 14px;">
              <strong>Questions?</strong> Contact us:
            </p>
            <p style="color: #6c757d; margin: 0; font-size: 14px;">
              Email: {{companyLocationEmail}}<br>
              Phone: {{companyLocationPhone}}
            </p>
          </div>
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; border-top: 1px solid #dee2e6; text-align: center;">
          <p style="color: #6c757d; margin: 0; font-size: 12px;">
            If you didn't expect this invitation, please contact us at {{companyLocationEmail}}.
          </p>
          <p style="color: #6c757d; margin: 10px 0 0 0; font-size: 12px;">
            &copy; {{currentYear}} {{companyName}}. All rights reserved.
          </p>
        </div>
      </div>
    `;

  const previousPortalInvitationText = `
Portal Access Invitation - {{companyName}}

Hello {{contactName}},

You have been invited to access the customer portal for {{companyName}}. This portal will give you access to view your tickets, invoices, and other important information.

Getting Started:
Click the link below to set up your portal account. You'll be able to create a secure password and access your information immediately.

Portal Setup Link: {{portalLink}}

IMPORTANT: This invitation link will expire in {{expirationTime}}. Please complete your account setup before then.

Questions? Contact us:
Email: {{companyLocationEmail}}
Phone: {{companyLocationPhone}}

If you didn't expect this invitation, please contact us at {{companyLocationEmail}}.

© {{currentYear}} {{companyName}}. All rights reserved.
    `;

  // Revert password-reset to previous version
  const previousPasswordResetHtml = `
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
</html>`;

  const previousPasswordResetText = `
Password Reset Request

Hello {{userName}},

We received a request to reset your password for your account associated with {{email}}.

To reset your password, please click the link below:
{{resetLink}}

IMPORTANT: This password reset link will expire in {{expirationTime}}. If you did not request a password reset, please ignore this email or contact support if you have concerns.

For security reasons, this link can only be used once.

If you're having trouble, please contact support at {{supportEmail}}

© {{currentYear}} {{clientName}}. All rights reserved.
`;

  await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .update({
      html_content: previousPortalInvitationHtml,
      text_content: previousPortalInvitationText,
      updated_at: new Date()
    });

  await knex('system_email_templates')
    .where({ name: 'password-reset' })
    .update({
      html_content: previousPasswordResetHtml,
      text_content: previousPasswordResetText,
      updated_at: new Date()
    });
};