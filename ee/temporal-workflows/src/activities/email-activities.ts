import { Context } from '@temporalio/activity';
import { emailService, type EmailParams } from '../services/email-service.js';
import type {
  SendWelcomeEmailActivityInput,
  SendWelcomeEmailActivityResult
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

/**
 * Generate a secure temporary password
 * This is an activity because it involves non-deterministic random number generation
 */
export async function generateTemporaryPassword(length: number = 12): Promise<string> {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  
  // Ensure at least one character from each category
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghijkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%^&*';
  
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill remaining length
  for (let i = 4; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

// Email template color scheme
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
};

/**
 * Create welcome email content
 */
function createWelcomeEmailContent(input: SendWelcomeEmailActivityInput): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  const { tenantName, adminUser, temporaryPassword } = input;
  const defaultLoginUrl = process.env.APPLICATION_URL;
  const currentYear = new Date().getFullYear();
  
  const subject = `Welcome to Alga PSA - Your Account is Ready`;
  
  const htmlBody = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Alga PSA</title>
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
      .credentials { 
        background: ${COLORS.primarySubtle}; 
        padding: 24px; 
        border-radius: 8px; 
        border: 1px solid ${COLORS.borderSubtle};
        border-left: 4px solid ${COLORS.primary};
        margin: 24px 0; 
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      .credentials h3 {
        color: ${COLORS.textPrimary};
        margin: 0 0 16px 0;
        font-size: 18px;
        font-weight: 600;
      }
      .credentials p {
        margin: 8px 0;
        color: ${COLORS.textSecondary};
      }
      .login-button { 
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
      .login-button:hover {
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
      .code { 
        font-family: 'Courier New', monospace; 
        background: ${COLORS.borderLight}; 
        padding: 4px 8px; 
        border-radius: 4px; 
        color: ${COLORS.textPrimary}; 
        font-size: 14px;
        font-weight: 600;
      }
      .brand-highlight { 
        color: ${COLORS.primary}; 
        font-weight: 600;
      }
      h2 {
        color: ${COLORS.textPrimary};
        font-family: Poppins, system-ui, sans-serif;
        font-size: 24px;
        font-weight: 600;
        margin: 0 0 16px 0;
      }
      h3 {
        color: ${COLORS.textPrimary};
        font-size: 18px;
        font-weight: 600;
        margin: 24px 0 12px 0;
      }
      p {
        color: ${COLORS.textSecondary};
        margin: 0 0 16px 0;
      }
      ol {
        color: ${COLORS.textSecondary};
        margin: 0 0 16px 0;
        padding-left: 24px;
      }
      ol li {
        margin: 8px 0;
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
    </style>
  </head>
  <body>
    <div class="header">
      <h1>Welcome to Alga PSA!</h1>
      <p>Your account has been successfully created</p>
    </div>
  
  <div class="content">
    <h2>Hello ${adminUser.firstName} ${adminUser.lastName},</h2>
    
    <p>Congratulations! Your new account for <strong>${tenantName}</strong> has been successfully set up on Alga PSA. You have been designated as the administrator and can now access both Alga PSA and your management portal.</p>
    
    <div class="tagline">
      Say goodbye to scattered tools, manual workarounds, and overly complex systems. Alga PSA by Nine Minds brings everything together in one powerful platform — intuitive, user-focused, and built to grow with your business.
    </div>
    
    <div class="credentials">
      <h3>Your Login Credentials</h3>
      <p><strong>Email:</strong> ${adminUser.email}</p>
      <p><strong>Temporary Password:</strong> <span class="code">${temporaryPassword}</span></p>
      <p><strong>Login URL:</strong> <a href="${defaultLoginUrl}">${defaultLoginUrl}</a></p>
    </div>
    
    <div class="warning">
      <h4>⚠️ Important Security Information</h4>
      <ul>
        <li>This is a <strong>temporary password</strong> that expires in 24 hours</li>
        <li>You will be required to change it on your first login</li>
        <li>Please store this password securely and do not share it</li>
        <li>If you don't login within 24 hours, you'll need to request a password reset</li>
      </ul>
    </div>
    
    <div style="text-align: center;">
      <a href="${defaultLoginUrl}" class="login-button">Login Now</a>
    </div>
    
    <div class="divider"></div>
    
    <h3>What's Next?</h3>
    <ol>
      <li>Click the login button above or visit: <a href="${defaultLoginUrl}">${defaultLoginUrl}</a></li>
      <li>Enter your email and temporary password</li>
      <li>Complete the onboarding wizard, including changing your password, setting up your profile, and configuring your ticketing and billing settings</li>
      <li>Start transforming your business with Alga PSA</li>
    </ol>
    
    <h3>Need Help?</h3>
    <p>If you have any questions or need assistance getting started, please don't hesitate to contact our support team.</p>
    
    <p>Welcome aboard!</p>
  </div>
  
  <div class="footer">
    <p>This email was sent automatically as part of your tenant creation process.</p>
    <p>If you did not request this account, please contact support.</p>
    <p>© ${currentYear} Nine Minds. All rights reserved.</p>
  </div>
</body>
</html>`;

  const textBody = `
Welcome to Alga PSA!

Hello ${adminUser.firstName} ${adminUser.lastName},

Congratulations! Your new tenant account for "${tenantName}" has been successfully set up.

LOGIN CREDENTIALS:
Email: ${adminUser.email}
Temporary Password: ${temporaryPassword}
Login URL: ${defaultLoginUrl}

IMPORTANT SECURITY INFORMATION:
- This is a temporary password that expires in 24 hours
- You will be required to change it on your first login
- Please store this password securely and do not share it
- If you don't login within 24 hours, you'll need to request a password reset

GETTING STARTED:
1. Visit: ${defaultLoginUrl}
2. Enter your email and temporary password
3. Create a new secure password when prompted
4. Complete your profile setup
5. Start configuring your tenant settings

Need help? Contact our support team if you have any questions.

Say goodbye to scattered tools, manual workarounds, and overly complex systems. Alga PSA by Nine Minds brings everything together in one powerful platform — intuitive, user-focused, and built to grow with your business.

Welcome aboard!

---
This email was sent automatically as part of your tenant creation process.
If you did not request this account, please contact support.

© ${currentYear} Nine Minds. All rights reserved.
`;

  return { subject, htmlBody, textBody };
}

/**
 * Send welcome email to the newly created admin user
 * This integrates with the existing email service infrastructure
 */
export async function sendWelcomeEmail(
  input: SendWelcomeEmailActivityInput
): Promise<SendWelcomeEmailActivityResult> {
  const log = logger();
  log.info('Sending welcome email', { 
    tenantId: input.tenantId,
    email: input.adminUser.email,
    userId: input.adminUser.userId
  });

  try {
    // Get the email service instance
    const emailServiceInstance = await emailService;
    
    // Create email content
    const { subject, htmlBody, textBody } = createWelcomeEmailContent(input);
    
    // Prepare email parameters
    const emailParams: EmailParams = {
      to: input.adminUser.email,
      subject,
      html: htmlBody,
      text: textBody,
      metadata: {
        tenantId: input.tenantId,
        userId: input.adminUser.userId,
        emailType: 'tenant_welcome',
        temporary: true,
        workflowType: 'tenant_creation'
      }
    };

    // Validate email before sending
    if (!emailServiceInstance.validateEmail(input.adminUser.email)) {
      throw new Error(`Invalid email address: ${input.adminUser.email}`);
    }

    // Send the email
    const emailResult = await emailServiceInstance.sendEmail(emailParams);

    log.info('Welcome email sent successfully', {
      tenantId: input.tenantId,
      email: input.adminUser.email,
      messageId: emailResult?.messageId
    });

    return {
      emailSent: true,
      messageId: emailResult?.messageId
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    log.error('Failed to send welcome email', {
      tenantId: input.tenantId,
      email: input.adminUser.email,
      error: errorMessage
    });

    // Don't throw the error - we don't want email failure to fail the entire workflow
    // The workflow can still complete successfully even if the email fails
    return {
      emailSent: false,
      error: errorMessage
    };
  }
}

/**
 * Send notification email about workflow completion to system administrators
 */
export async function sendTenantCreationNotification(
  tenantId: string,
  tenantName: string,
  adminEmail: string,
  success: boolean
): Promise<void> {
  const log = logger();
  
  try {
    // This would send a notification to system administrators
    // about the tenant creation completion
    log.info('Tenant creation notification', {
      tenantId,
      tenantName,
      adminEmail,
      success
    });

    // Implementation would depend on your notification system
    // Could be email, Slack, webhook, etc.
    
  } catch (error) {
    log.warn('Failed to send tenant creation notification', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    // Don't throw - this is just a notification
  }
}