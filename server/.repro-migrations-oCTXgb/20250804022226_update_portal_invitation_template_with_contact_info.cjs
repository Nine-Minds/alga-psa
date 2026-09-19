/**
 * Update portal invitation email template to include company contact information
 */
exports.up = async function(knex) {
  // Update the portal-invitation email template
  const emailTemplate = await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .first();

  if (emailTemplate) {
    const updatedHtmlContent = `
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

    const updatedTextContent = `
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

    await knex('system_email_templates')
      .where({ id: emailTemplate.id })
      .update({
        html_content: updatedHtmlContent,
        text_content: updatedTextContent,
        updated_at: new Date()
      });
  }
};

exports.down = async function(knex) {
  // Revert to the original template content
  const emailTemplate = await knex('system_email_templates')
    .where({ name: 'portal-invitation' })
    .first();

  if (emailTemplate) {
    const originalHtmlContent = `
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
    `;

    const originalTextContent = `
Portal Access Invitation - {{companyName}}

Hello {{contactName}},

You have been invited to access the customer portal for {{companyName}}. This portal will give you access to view your tickets, invoices, and other important information.

Getting Started:
Click the link below to set up your portal account. You'll be able to create a secure password and access your information immediately.

Portal Setup Link: {{portalLink}}

IMPORTANT: This invitation link will expire in {{expirationTime}}. Please complete your account setup before then.

If you didn't expect this invitation or have questions, please contact us.

© {{currentYear}} {{companyName}}. All rights reserved.
    `;

    await knex('system_email_templates')
      .where({ id: emailTemplate.id })
      .update({
        html_content: originalHtmlContent,
        text_content: originalTextContent,
        updated_at: new Date()
      });
  }
};